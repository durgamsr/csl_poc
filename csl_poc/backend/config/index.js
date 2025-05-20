require('dotenv').config();

// Central configuration file that exports all environment variables
const config = {
  // AWS S3 Configuration
  aws: {
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    s3: {
      bucketName: process.env.S3_BUCKET_NAME
    },
    dynamoDB: {
      tableName: process.env.DYNAMODB_TABLE_NAME
    },
    apiGateway: {
      endpoint: process.env.API_GATEWAY_ENDPOINT || 'https://isw1w2sh3i.execute-api.us-east-1.amazonaws.com/myfiles'
    }
  },
  
  // AWS Cognito Configuration
  cognito: {
    clientId: process.env.COGNITO_CLIENT_ID ,
    clientSecret: process.env.COGNITO_CLIENT_SECRET,
    userPoolId: process.env.COGNITO_USER_POOL_ID,
    region: process.env.COGNITO_REGION,
    redirectUri: process.env.COGNITO_REDIRECT_URI 
  },
  
  // Server Configuration
  server: {
    port: process.env.PORT || 3001,
    sessionSecret: process.env.SESSION_SECRET,
    cors: {
      origins: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : 
        ['http://localhost:3000', 'https://isw1w2sh3i.execute-api.us-east-1.amazonaws.com']
    }
  }
};

module.exports = config; 