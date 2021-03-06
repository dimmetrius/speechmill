/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for
 * license information.
 */
'use strict';

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').load();
}

const os = require('os');
const async = require('async');
const util = require('util');
const uuidv4 = require('uuid/v4');
const path = require('path');
const url = require('url');
const fs = require('fs');

const MediaServices = require('azure-arm-mediaservices');
const msRestAzure = require('ms-rest-azure');
const msRest = require('ms-rest');
const azureStorage = require('azure-storage');

const setTimeoutPromise = util.promisify(setTimeout);

const config = require('./config.json');

const AUDIO_ANALIZE = 'AUDIO_ANALIZE';

const _log = value => {
  console.log(new Date(), value);
};

const DELETE_ASSETS = true;

const processing = {};

// endpoint config
// make sure your URL values end with '/'

const armAadAudience = config.ArmAadAudience;
const aadEndpoint = config.AadEndpoint;
const armEndpoint = config.ArmEndpoint;
const subscriptionId = config.SubscriptionId;
const accountName = config.AccountName;
const region = config.Region;
const aadClientId = config.AadClientId;
const aadSecret = config.AadSecret;
const aadTenantId = config.AadTenantId;
const resourceGroup = config.ResourceGroup;

// args
const outputFolder = './Temp';
//
const namePrefix = 'prefix';

// You can either specify a local input file with the inputFile or an input Url with inputUrl.  Set the other one to null.

// These are the names used for creating and finding your transforms
const audioAnalyzerTransformName = 'AudioAnalyzerTransform';
const videoAnalyzerTransformName = 'VideoAnalyzerTransform';

// constants
const audioExtensions = ['.mp4a', '.mp3', '.wav'];
const timeoutSeconds = 60 * 10;
const sleepInterval = 1000 * 15;

let azureMediaServicesClient;
let blobName = null;

const processVideBlob = async (id, nm) => {
  const inputUrl =
    'https://speechmillstorage.blob.core.windows.net/videos/' + id + '/' + nm;

  let inputExtension = path.extname(inputUrl);

  async function getJobInputFromArguments(
    //resourceGroup,
    //accountName,
    uniqueness
  ) {
    return {
      odatatype: '#Microsoft.Media.JobInputHttp',
      files: [inputUrl],
    };
  }

  async function downloadResults(
    resourceGroup,
    accountName,
    assetName,
    resultsFolder
  ) {
    let date = new Date();
    date.setHours(date.getHours() + 1);
    let input = {
      permissions: 'Read',
      expiryTime: date,
    };
    let assetContainerSas = await azureMediaServicesClient.assets.listContainerSas(
      resourceGroup,
      accountName,
      assetName,
      input
    );

    let containerSasUrl = assetContainerSas.assetContainerSasUrls[0] || null;
    let sasUri = url.parse(containerSasUrl);
    let sharedBlobService = azureStorage.createBlobServiceWithSas(
      sasUri.host,
      sasUri.search
    );
    let containerName = sasUri.pathname.replace(/^\/+/g, '');
    let directory = path.join(resultsFolder, assetName);
    try {
      fs.mkdirSync(directory);
    } catch (err) {
      // directory exists
    }
    _log(`gathering blobs in container ${containerName}...`);
    function createBlobListPromise() {
      return new Promise(function(resolve, reject) {
        return sharedBlobService.listBlobsSegmented(
          containerName,
          null,
          (err, result, response) => {
            if (err) {
              reject(err);
            }
            resolve(result);
          }
        );
      });
    }
    let blobs = await createBlobListPromise();
    _log('downloading blobs to local directory in background...');
    const service = azureStorage.createBlobService();
    for (let i = 0; i < blobs.entries.length; i++) {
      let blob = blobs.entries[i];
      if (blob.blobType == 'BlockBlob') {
        sharedBlobService.getBlobToLocalFile(
          containerName,
          blob.name,
          path.join(directory, blob.name),
          (error, result) => {
            try {
              service.createBlockBlobFromLocalFile(
                'transcriptions',
                id + '/' + blob.name,
                path.join(directory, blob.name),
                function(error, result, response) {
                  if (!error) {
                    // file uploaded
                  } else {
                    _log(error);
                  }
                }
              );
            } catch (e) {
              _log(e);
            }
            if (error) _log(error);
          }
        );
      }
    }
  }

  function selectTransform(preset) {
    if (
      audioExtensions.indexOf(inputExtension) > -1 ||
      preset == AUDIO_ANALIZE
    ) {
      return audioAnalyzerTransformName;
    } else {
      return videoAnalyzerTransformName;
    }
  }

  try {
    // Ensure that you have customized transforms for the AudioAnalyzer and VideoAnalyzer.  This is really a one time setup operation.
    _log('creating audio analyzer transform...');
    let audioAnalyzerTransform = await ensureTransformExists(
      resourceGroup,
      accountName,
      audioAnalyzerTransformName,
      audioAnalyzerPreset()
    );
    _log('creating video analyzer transform...');
    let videoAnalyzerTransform = await ensureTransformExists(
      resourceGroup,
      accountName,
      videoAnalyzerTransformName,
      videoAnalyzerPreset()
    );

    _log('getting job input from arguments...');
    let uniqueness = uuidv4();
    let input = await getJobInputFromArguments(uniqueness);
    let outputAssetName = namePrefix + '-output-' + uniqueness;
    let jobName = namePrefix + '-job-' + uniqueness;

    _log('creating output asset...');
    let outputAsset = await createOutputAsset(
      resourceGroup,
      accountName,
      outputAssetName
    );

    // Choose between the Audio and Video analyzer transforms
    let transformName = selectTransform(/*AUDIO_ANALIZE*/);

    _log('submitting job...');
    let job = await submitJob(
      resourceGroup,
      accountName,
      transformName,
      jobName,
      input,
      outputAsset.name
    );

    _log('waiting for job to finish...');
    job = await waitForJobToFinish(
      resourceGroup,
      accountName,
      transformName,
      jobName
    );

    if (job.state == 'Finished') {
      await downloadResults(
        resourceGroup,
        accountName,
        outputAsset.name,
        outputFolder
      );

      _log('deleting jobs');
      await azureMediaServicesClient.jobs.deleteMethod(
        resourceGroup,
        accountName,
        transformName,
        jobName
      );

      if (DELETE_ASSETS) {
        _log('deleting assets...');
        await azureMediaServicesClient.assets.deleteMethod(
          resourceGroup,
          accountName,
          outputAsset.name
        );

        let jobInputAsset = input;
        if (jobInputAsset && jobInputAsset.assetName) {
          await azureMediaServicesClient.assets.deleteMethod(
            resourceGroup,
            accountName,
            jobInputAsset.assetName
          );
        }
      }
    } else if (job.state == 'Error') {
      _log(`${job.name} failed. Error details:`);
      _log(job.outputs[0].error);
    } else if (job.state == 'Canceled') {
      _log(`${job.name} was unexpectedly canceled.`);
    } else {
      _log(`${job.name} is still in progress.  Current state is ${job.state}.`);
    }
    _log('done with sample');
  } catch (err) {
    _log(err);
  }
};

msRestAzure.loginWithServicePrincipalSecret(
  aadClientId,
  aadSecret,
  aadTenantId,
  {
    environment: {
      activeDirectoryResourceId: armAadAudience,
      resourceManagerEndpointUrl: armEndpoint,
      activeDirectoryEndpointUrl: aadEndpoint,
    },
  },
  async function(err, credentials, subscriptions) {
    if (err) return _log(err);
    azureMediaServicesClient = new MediaServices(
      credentials,
      subscriptionId,
      armEndpoint,
      { noRetryPolicy: true }
    );

    //await processVideBlob();
  }
);

async function waitForJobToFinish(
  resourceGroup,
  accountName,
  transformName,
  jobName
) {
  let timeout = new Date();
  timeout.setSeconds(timeout.getSeconds() + timeoutSeconds);

  async function pollForJobStatus() {
    let job = await azureMediaServicesClient.jobs.get(
      resourceGroup,
      accountName,
      transformName,
      jobName
    );
    _log(job.state);
    if (
      job.state == 'Finished' ||
      job.state == 'Error' ||
      job.state == 'Canceled'
    ) {
      return job;
    } else if (new Date() > timeout) {
      _log(`Job ${job.name} timed out.`);
      return job;
    } else {
      await setTimeoutPromise(sleepInterval, null);
      return pollForJobStatus();
    }
  }

  return await pollForJobStatus();
}

async function submitJob(
  resourceGroup,
  accountName,
  transformName,
  jobName,
  jobInput,
  outputAssetName
) {
  let jobOutputs = [
    {
      odatatype: '#Microsoft.Media.JobOutputAsset',
      assetName: outputAssetName,
    },
  ];

  return await azureMediaServicesClient.jobs.create(
    resourceGroup,
    accountName,
    transformName,
    jobName,
    {
      input: jobInput,
      outputs: jobOutputs,
    }
  );
}

async function createOutputAsset(resourceGroup, accountName, assetName) {
  return await azureMediaServicesClient.assets.createOrUpdate(
    resourceGroup,
    accountName,
    assetName,
    {}
  );
}

async function createInputAsset(
  resourceGroup,
  accountName,
  assetName,
  fileToUpload
) {
  let asset = await azureMediaServicesClient.assets.createOrUpdate(
    resourceGroup,
    accountName,
    assetName,
    {}
  );
  let date = new Date();
  date.setHours(date.getHours() + 1);
  let input = {
    permissions: 'ReadWrite',
    expiryTime: date,
  };
  let response = await azureMediaServicesClient.assets.listContainerSas(
    resourceGroup,
    accountName,
    assetName,
    input
  );
  let uploadSasUrl = response.assetContainerSasUrls[0] || null;
  let fileName = path.basename(fileToUpload);
  let sasUri = url.parse(uploadSasUrl);
  let sharedBlobService = azureStorage.createBlobServiceWithSas(
    sasUri.host,
    sasUri.search
  );
  let containerName = sasUri.pathname.replace(/^\/+/g, '');
  let randomInt = Math.round(Math.random() * 100);
  blobName = fileName + randomInt;
  _log('uploading to blob...');
  function createBlobPromise() {
    return new Promise(function(resolve, reject) {
      sharedBlobService.createBlockBlobFromLocalFile(
        containerName,
        blobName,
        fileToUpload,
        resolve
      );
    });
  }
  await createBlobPromise();
  return asset;
}

async function ensureTransformExists(
  resourceGroup,
  accountName,
  transformName,
  preset
) {
  let transform = await azureMediaServicesClient.transforms.get(
    resourceGroup,
    accountName,
    transformName
  );
  if (!transform) {
    transform = await azureMediaServicesClient.transforms.createOrUpdate(
      resourceGroup,
      accountName,
      transformName,
      {
        name: transformName,
        location: region,
        outputs: [
          {
            preset: preset,
          },
        ],
      }
    );
  }
  return transform;
}

function audioAnalyzerPreset() {
  return {
    audioLanguage: null,
    odatatype: '#Microsoft.Media.AudioAnalyzerPreset',
  };
}

function videoAnalyzerPreset() {
  return {
    audioLanguage: null,
    odatatype: '#Microsoft.Media.VideoAnalyzerPreset',
  };
}

const getStatus = id => {
  return processing[id];
};

const serv = {
  processVideBlob: processVideBlob,
  status: getStatus,
};

module.exports = serv;
