# Configuration System

This application uses a centralized configuration system to manage all sensitive API keys, credentials, and application settings. 

## How the Configuration Works

1. **Environment Variables**: The application uses environment variables to store sensitive information. These are loaded using the `dotenv` package.

2. **Centralized Config File**: All configuration is managed through a central file at `backend/config/index.js`. This file loads environment variables and provides default values when needed.

3. **Configuration Modules**: Specialized configuration files like `aws.js` and `cognito.js` import settings from the central config file.

## Setting Up Your Environment

1. Copy the example environment file:
   ```
   cp backend/example.env backend/.env
   ```

2. Edit the `.env` file with your own credentials:
   ```
   # AWS S3 Configuration
   AWS_REGION=your-aws-region
   AWS_ACCESS_KEY_ID=your-aws-access-key-id
   AWS_SECRET_ACCESS_KEY=your-aws-secret-access-key
   S3_BUCKET_NAME=your-s3-bucket-name

   # DynamoDB Configuration
   DYNAMODB_TABLE_NAME=userFiles

   # AWS Cognito Configuration 
   COGNITO_CLIENT_ID=your-cognito-client-id
   COGNITO_CLIENT_SECRET=your-cognito-client-secret
   COGNITO_USER_POOL_ID=your-cognito-user-pool-id
   COGNITO_REGION=your-cognito-region
   COGNITO_REDIRECT_URI=http://localhost:3001/callback

   # Server Configuration
   PORT=3001
   SESSION_SECRET=your-secure-session-secret-key

   # CORS Configuration
   CORS_ORIGINS=http://localhost:3000,https://your-api-gateway-url.execute-api.region.amazonaws.com
   ```

3. The application will automatically load these environment variables at startup.

## Adding New Configuration Values

If you need to add new configuration values:

1. Add the environment variable to your `.env` file.
2. Add the variable to the `example.env` file as a reference for others.
3. Add the value to the centralized config in `backend/config/index.js`.
4. Reference the value using the config object: `const config = require('./config')` or `const config = require('../config')` depending on file location.

## Security Best Practices

1. Never commit the `.env` file to source control.
2. Regularly rotate your API keys and credentials.
3. Use specific IAM roles with least privilege principles for AWS credentials.
4. When deploying to production, use environment-specific credential management systems (AWS Parameter Store, Secrets Manager, etc.). 