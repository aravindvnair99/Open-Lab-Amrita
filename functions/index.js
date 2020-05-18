const functions = require("firebase-functions"),
	express = require("express"),
	app = express(),
	bodyParser = require("body-parser"),
	admin = require("firebase-admin"),
	cookieParser = require("cookie-parser"),
	Busboy = require("busboy"),
	path = require("path"),
	os = require("os"),
	fs = require("fs"),
	vader = require("vader-sentiment"),
	{ PredictionServiceClient } = require("@google-cloud/automl").v1;

/*=============================================>>>>>

				= init and config =

===============================================>>>>>*/

admin.initializeApp({
	credential: admin.credential.applicationDefault(),
	storageBucket: process.env.GCLOUD_PROJECT + ".appspot.com",
});
app.use(bodyParser.json());
app.use(
	bodyParser.urlencoded({
		extended: true,
	})
);
app.use((req, res, next) => {
	if (
		req.rawBody === undefined &&
		req.method === "POST" &&
		req.headers["content-type"].startsWith("multipart/form-data")
	) {
		getRawBody(
			req,
			{
				length: req.headers["content-length"],
				limit: "10mb",
				encoding: contentType.parse(req).parameters.charset,
			},
			(err, string) => {
				if (err) return next(err);
				req.rawBody = string;
				return next();
			}
		);
	} else {
		return next();
	}
});

app.use((req, res, next) => {
	if (
		req.method === "POST" &&
		req.headers["content-type"].startsWith("multipart/form-data")
	) {
		const busboy = new Busboy({ headers: req.headers });
		let fileBuffer = new Buffer("");
		req.files = {
			file: [],
		};

		busboy.on("field", (fieldname, value) => {
			req.body[fieldname] = value;
		});

		busboy.on("file", (fieldname, file, filename, encoding, mimetype) => {
			var saveTo = path.join(os.tmpdir(), path.basename(fieldname));
			file.pipe(fs.createWriteStream(saveTo));
			file.on("data", (data) => {
				fileBuffer = Buffer.concat([fileBuffer, data]);
			});

			file.on("end", () => {
				const file_object = {
					fieldname,
					originalname: filename,
					encoding,
					mimetype,
					buffer: fileBuffer,
				};
				req.files.file.push(file_object);
			});
		});

		busboy.on("finish", () => {
			next();
		});

		busboy.end(req.rawBody);
		req.pipe(busboy);
	} else {
		next();
		return;
	}
});
app.use(cookieParser());
app.set("views", "./views");
app.set("view engine", "ejs");
const client = new PredictionServiceClient();
const db = admin.firestore();
const storage = admin.storage();

/*=============================================>>>>>

				= security functions =

===============================================>>>>>*/

function checkCookieMiddleware(req, res, next) {
	const sessionCookie = req.cookies.__session || "";
	admin
		.auth()
		.verifySessionCookie(sessionCookie, true)
		.then((decodedClaims) => {
			req.decodedClaims = decodedClaims;
			next();
			return;
		})
		.catch((error) => {
			console.log(error);
			res.redirect("/signOut");
		});
}
function setCookie(idToken, res, isNewUser) {
	const expiresIn = 60 * 60 * 24 * 5 * 1000;
	admin
		.auth()
		.createSessionCookie(idToken, { expiresIn })
		.then(
			(sessionCookie) => {
				const options = {
					maxAge: expiresIn,
					httpOnly: true,
					secure: false, //should be true in prod
				};
				res.cookie("__session", sessionCookie, options);
				admin
					.auth()
					.verifyIdToken(idToken)
					.then((decodedClaims) => {
						console.log("\n\n\n", isNewUser);
						if (isNewUser === "true") {
							res.redirect("/dashboard");
							return console.log(decodedClaims);
						} else {
							res.redirect("/dashboard");
							return console.log(decodedClaims);
						}
					})
					.catch((error) => {
						console.log(error);
					});
				return;
			},
			(error) => {
				console.log(error);
				res.status(401).send("UNAUTHORIZED REQUEST!");
			}
		)
		.catch((error) => {
			console.log(error);
		});
}

/*=============================================>>>>>

				= AutoML =

===============================================>>>>>*/

function base64_encode(file) {
	// read binary data
	var bitmap = fs.readFileSync(file);
	// convert binary data to base64 encoded string
	return new Buffer(bitmap).toString("base64");
}
function AutoMLAPI(content) {
	async function predict() {
		const request = {
			name: client.modelPath(
				"spot-the-hole",
				"us-central1",
				"ICN4586489609965273088"
			),
			payload: {
				image: {
					imageBytes: content,
				},
			},
		};
		const [response] = await client.predict(request);
		return response.payload;
		// for (const annotationPayload of response.payload) {
		// 	console.log(
		// 		`Predicted class name: ${annotationPayload.displayName}`
		// 	);
		// 	console.log(
		// 		`Predicted class score: ${annotationPayload.classification.score}`
		// 	);
		// }
	}
	return predict();
}
/*=============================================>>>>>

				= Vader =

===============================================>>>>>*/

function vader_analysis(input) {
	return vader.SentimentIntensityAnalyzer.polarity_scores(input);
}

/*=============================================>>>>>

				= basic routes =

===============================================>>>>>*/

app.get("/", (req, res) => {
	if (req.cookies.__session) {
		res.redirect("/dashboard");
	} else {
		res.redirect("/login");
	}
});
app.get("/dashboard", checkCookieMiddleware, (req, res) => {
	var i = 0,
		potholeData = new Array(),
		potholeID = new Array();
	db.collection("users")
		.doc(req.decodedClaims.uid)
		.collection("potholes")
		.get()
		.then((querySnapshot) => {
			querySnapshot.forEach((childSnapshot) => {
				potholeID[i] = childSnapshot.id;
				potholeData[i] = childSnapshot.data();
				i++;
			});
			potholesData = Object.assign({}, potholeData);
			potholesID = Object.assign({}, potholeID);
			user = Object.assign({}, req.decodedClaims);
			console.log("\n\n\n", user);
			return res.render("dashboard", { user, potholesData, potholesID });
		})
		.catch((err) => {
			console.log("Error getting potholes", err);
			res.redirect("/login");
		});
});
app.get("/offline", (req, res) => {
	res.render("offline");
});

/*=============================================>>>>>

				= legal routes =

===============================================>>>>>*/

app.get("/EULA", (req, res) => {
	res.render("legal/EULA");
});
app.get("/disclaimer", (req, res) => {
	res.render("legal/disclaimer");
});
app.get("/privacyPolicy", (req, res) => {
	res.render("legal/privacyPolicy");
});
app.get("/termsConditions", (req, res) => {
	res.render("legal/termsConditions");
});

/*=============================================>>>>>

			= authentication routes =

===============================================>>>>>*/

app.get("/login", (req, res) => {
	if (req.cookies.__session) {
		res.render("dashboard");
	} else {
		res.render("login");
	}
});
app.get("/sessionLogin", (req, res) => {
	setCookie(req.query.idToken, res, req.query.isNewUser);
});
app.get("/signOut", (req, res) => {
	res.clearCookie("__session");
	res.redirect("/login");
});
app.get("/uid", checkCookieMiddleware, (req, res) => {
	res.send(req.decodedClaims.uid);
});
app.post("/onLogin", (req, res) => {
	admin
		.auth()
		.verifyIdToken(req.body.idToken, true)
		.then((decodedToken) => {
			admin
				.auth()
				.getUser(decodedToken.uid)
				.then((userRecord) => {
					console.log(
						"Successfully fetched user data:",
						userRecord.toJSON()
					);
					if (userRecord.phoneNumber && userRecord.emailVerified) {
						return res.send({ path: "/dashboard" });
					} else if (!userRecord.emailVerified) {
						return res.send({ path: "/emailVerification" });
					} else {
						return res.send({ path: "/updateProfile" });
					}
				})
				.catch((error) => {
					console.log("Error fetching user data:", error);
					res.send("/login");
				});
			return;
		})
		.catch((error) => {
			console.log(error);
			res.send("/login");
		});
});
app.get("/emailVerification", (req, res) => {
	res.render("emailVerification");
});
app.get("/updateProfile", (req, res) => {
	res.render("updateProfile");
});
app.post("/onUpdateProfile", (req, res) => {
	admin
		.auth()
		.updateUser(req.body.uid, {
			phoneNumber: "+91" + req.body.phoneNumber,
			password: req.body.password,
			displayName: req.body.firstName + " " + req.body.lastName,
			photoURL: req.body.photoURL,
		})
		.then((userRecord) => {
			console.log("Successfully updated user", userRecord.toJSON());
			return res.redirect("/login");
		})
		.catch((error) => {
			console.log("Error updating user:", error);
		});
});

/*=============================================>>>>>

			= AutoML routes =

===============================================>>>>>*/

app.get("/cameraCapture", checkCookieMiddleware, (req, res) => {
	res.render("cameraCapture");
});
app.get("/cameraCaptureRetry", checkCookieMiddleware, (req, res) => {
	res.render("cameraCaptureRetry");
});
app.post("/uploadPotholePicture", checkCookieMiddleware, (req, res) => {
	var base64str = base64_encode(
		path.join(os.tmpdir(), path.basename(req.files.file[0].fieldname))
	);
	AutoMLAPI(base64str)
		.then((prediction) => {
			console.log(prediction[0]);
			if (
				prediction[0].displayName === "pothole" &&
				prediction[0].classification.score >= 0.93
			) {
				storage.bucket().upload(
					path.join(
						os.tmpdir(),
						path.basename(req.files.file[0].fieldname)
					),
					{
						destination:
							"potholePictures/" +
							req.decodedClaims.uid +
							"/" +
							req.files.file[0].originalname,
						public: true,
						metadata: {
							contentType: req.files.file[0].mimetype,
							cacheControl: "public, max-age=300",
						},
					},
					(err, file) => {
						if (err) {
							console.log(err);
							return;
						}
						console.log(file.metadata);
						var pictureData = {
							photo: file.metadata.mediaLink,
						};
						string = encodeURIComponent(file.metadata.mediaLink);
						return res.redirect("/report?image=" + string);
					}
				);
			} else return res.redirect("/cameraCaptureRetry");
		})
		.catch((error) => {
			console.log("Error is:", error);
		});
});

/*=============================================>>>>>

				= Report =

===============================================>>>>>*/
app.get("/report", checkCookieMiddleware, (req, res) => {
	console.log("\n\n\n", req.query.image);
	res.render("report", {
		pothole: req.query.image,
	});
});
app.post("/submitReport", checkCookieMiddleware, (req, res) => {
	var obj = {
		latitude: req.body.latitude,
		longitude: req.body.longitude,
		image: req.body.imageURL,
		description: req.body.description,
		neg: vader_analysis(req.body.description).neg * 100,
	};
	console.log(obj);
	db.collection("users")
		.doc(req.decodedClaims.uid)
		.collection("potholes")
		.doc()
		.set(obj);
	res.redirect("/dashboard");
});
/*=============================================>>>>>

				= errors =

===============================================>>>>>*/

app.use((req, res, next) => {
	res.status(404).render("404");
});
app.use((req, res, next) => {
	res.status(500).render("500");
});

/*=============================================>>>>>

				= DO NOT PUT ANYTHING AFTER THIS =

===============================================>>>>>*/

exports.app = functions.https.onRequest(app);
