if (process.env.NODE_ENV !== 'production') {
  require('dotenv').load();
}

const express = require('express'),
  router = express.Router(),
  multer = require('multer'),
  inMemoryStorage = multer.memoryStorage(),
  uploadStrategy = multer({ storage: inMemoryStorage }).single('image'),
  azureStorage = require('azure-storage'),
  blobService = azureStorage.createBlobService(),
  getStream = require('into-stream'),
  containerName = 'videos',
  serv = require('./../index');
const handleError = (err, res) => {
  res.status(500);
  res.render('error', { error: err });
};

router.post('/', uploadStrategy, (req, res) => {
  const identifier = Math.random()
    .toString()
    .replace(/0\./, ''); // remove "0." from start of string
  const originalName = req.file.originalname;

  const blobName = `${identifier}/${originalName}`,
    stream = getStream(req.file.buffer),
    streamLength = req.file.buffer.length;
  blobService.createBlockBlobFromStream(
    containerName,
    blobName,
    stream,
    streamLength,
    err => {
      if (err) {
        handleError(err);
        return;
      }

      res.render('success', {
        message: 'File uploaded to Azure Blob storage.' + blobName,
      });

      serv.processVideBlob(identifier, originalName);
    }
  );
});

module.exports = router;
