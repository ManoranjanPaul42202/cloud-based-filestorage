const express = require("express");
const router = express.Router();
const multer = require("multer");
const fileController = require("../controllers/fileController");

const upload = multer({ dest: "uploads/" });

router.get("/download", fileController.getDownloadUrl);
router.post("/upload", upload.single("file"), fileController.uploadFile);
router.get("/", fileController.getFiles);
router.delete("/:id", fileController.deleteFile);

module.exports = router;
