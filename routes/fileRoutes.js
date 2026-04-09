const express = require("express");
const router = express.Router();
const multer = require("multer");
const fileController = require("../controllers/fileController");
const authMiddleware = require("../middlewares/authMiddleware");
const fileAccessMiddleware = require("../middlewares/fileAccessMiddleware");

const upload = multer({ dest: "uploads/" });

router.use(authMiddleware);
router.param("id", fileAccessMiddleware.loadFile);

router.get("/shared", fileController.getSharedFiles);
router.get("/download", fileController.getDownloadUrl);
router.post("/upload", upload.single("file"), fileController.uploadFile);
router.get("/", fileController.getFiles);
router.post("/:id/share", fileAccessMiddleware.requireOwner, fileController.shareFile);
router.delete("/:id/share", fileAccessMiddleware.requireOwner, fileController.revokeShare);
router.patch("/:id/visibility", fileAccessMiddleware.requireOwner, fileController.changeVisibility);
router.patch("/:id", fileAccessMiddleware.requireOwner, fileController.renameFile);
router.delete("/:id", fileAccessMiddleware.requireOwner, fileController.deleteFile);
router.get("/:id", fileAccessMiddleware.requireFileAccess, fileController.getFileById);

module.exports = router;
