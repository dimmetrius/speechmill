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

  blobService.listBlobsSegmented('transcriptions', null, (err, data) => {
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
        title: 'Home',
        viewName: 'aifiles',
        accountName: config.getStorageAccountName(),
      };

      if (data.entries.length) {
        viewData.files = data.entries.map(entry => {
          const split = entry.name.split('/');
          const id = split[0];
          const nm = split[1];
          return { ...entry, id, nm };
        });
      }
    }

    res.render(viewData.viewName, viewData);
  });
});

module.exports = router;
