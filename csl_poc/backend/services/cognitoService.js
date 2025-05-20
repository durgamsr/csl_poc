const { Issuer } = require('openid-client');
const { logTokenInfo } = require('../utils/logger');
const COGNITO_CONFIG = require('../config/cognito');

let client;

// Initialize OpenID Client
async function initializeClient() {
    try {
        console.log('Initializing OpenID Client...');
        // Use the AWS recommended format for discovery URL
        const issuer = await Issuer.discover(`https://cognito-idp.${COGNITO_CONFIG.region}.amazonaws.com/${COGNITO_CONFIG.userPoolId}/.well-known/openid-configuration`);
        console.log('Issuer discovered successfully');
        console.log('Issuer metadata:', issuer.metadata);
        
        client = new issuer.Client({
            client_id: COGNITO_CONFIG.clientId,
            client_secret: COGNITO_CONFIG.clientSecret,
            redirect_uris: [COGNITO_CONFIG.redirectUri],
            response_types: ['code']
        });
        
        console.log('Client initialized successfully');
        return client;
    } catch (error) {
        console.error('Error initializing client:', error);
        throw error;
    }
}

// Process authentication callback
async function processCallback(params, session) {
    try {
        const tokenSet = await client.callback(
            COGNITO_CONFIG.redirectUri,
            params,
            {
                nonce: session.nonce,
                state: session.state
            }
        );
        
        // Log token information
        console.log('Logging token info from callback:');
        logTokenInfo(tokenSet);
        
        // Get user info
        const userInfo = await client.userinfo(tokenSet.access_token);
        
        // Add the Cognito username to the user info
        try {
            // First try using claims() function if available
            if (tokenSet.claims && typeof tokenSet.claims === 'function') {
                const claims = tokenSet.claims();
                if (claims['cognito:username']) {
                    userInfo.username = claims['cognito:username'];
                    console.log(`Set username from cognito:username: ${userInfo.username}`);
                }
            } 
            // Fallback to directly parsing the id_token if available
            else if (tokenSet.id_token && typeof tokenSet.id_token === 'string') {
                const parts = tokenSet.id_token.split('.');
                if (parts.length === 3) {
                    try {
                        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
                        if (payload && payload['cognito:username']) {
                            userInfo.username = payload['cognito:username'];
                            console.log(`Set username from JWT payload: ${userInfo.username}`);
                        }
                    } catch (e) {
                        console.error('Error decoding JWT payload:', e);
                    }
                }
            }
        } catch (err) {
            console.error('Error extracting username from token:', err);
            // Continue even if username extraction fails
        }
        
        return {
            userInfo,
            tokenSet
        };
    } catch (error) {
        console.error('Error processing callback:', error);
        throw error;
    }
}

// Get authorization URL for login
function getAuthorizationUrl(nonce, state) {
    return client.authorizationUrl({
        scope: 'email openid phone',
        response_type: 'code',
        state: state,
        nonce: nonce,
    });
}

// Build logout URL
function getLogoutUrl(redirectUri = 'http://localhost:3000') {
    // Using the format with domain prefix
    const domainPrefix = COGNITO_CONFIG.userPoolId.split('_')[1].toLowerCase();
    const clientId = COGNITO_CONFIG.clientId;
    const region = COGNITO_CONFIG.region;
    const encodedRedirectUri = encodeURIComponent(redirectUri);
    
    return `https://${region}${domainPrefix}.auth.${region}.amazoncognito.com/logout?client_id=${clientId}&logout_uri=${encodedRedirectUri}`;
}

module.exports = {
    initializeClient,
    processCallback,
    getAuthorizationUrl,
    getLogoutUrl,
    client: () => client
}; 