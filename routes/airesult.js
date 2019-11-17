if (process.env.NODE_ENV !== 'production') {
  require('dotenv').load();
}

const express = require('express'),
  router = express.Router(),
  azureStorage = require('azure-storage'),
  blobService = azureStorage.createBlobService(),
  config = require('../config');

router.get('/:videoId/:fileId', (req, res, next) => {
  const videoId = req.param('videoId');
  const fileId = req.param('fileId');

  blobService.getBlobToStream(
    'transcriptions',
    videoId + '/' + fileId,
    res,
    () => {}
  );
});

module.exports = router;
