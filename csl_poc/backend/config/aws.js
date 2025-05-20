const AWS = require('aws-sdk');
const config = require('./index');

// Configure AWS
AWS.config.update({
    region: config.aws.region,
    accessKeyId: config.aws.accessKeyId,
    secretAccessKey: config.aws.secretAccessKey
});

// Initialize S3 client
const s3 = new AWS.S3();
const BUCKET_NAME = config.aws.s3.bucketName;

module.exports = {
    AWS,
    s3,
    BUCKET_NAME
}; 