if (process.env.NODE_ENV !== 'production') {
  require('dotenv').load();
}

const express = require('express'),
  router = express.Router(),
  azureStorage = require('azure-storage'),
  blobService = azureStorage.createBlobService(),
  config = require('../config');

router.get('/:videoId', (req, res, next) => {
  const videoId = req.param('videoId');
  blobService.listBlobsSegmented('videos', null, (err, data) => {
    let viewData;

    if (err) {
      viewData = {
        title: 'Error',
        viewName: 'error',
        message: 'There was an error contacting the blob storage container.',
        error: err,
      };

      res.status(500);
    } else {
      viewData = {
        message: 'MSG',
        title: 'Home',
        viewName: 'video',
        accountName: config.getStorageAccountName(),
        containerName: 'videos',
      };

      if (data.entries.length) {
        viewData.videos = data.entries
          .filter(entry => entry.name.indexOf(videoId + '/') == 0)
          .map(data => {
            const nm = data.name.split('/')[1];
            return { ...data, id: videoId, nm };
          });
      }
    }

    res.render(viewData.viewName, viewData);
  });
});

module.exports = router;
