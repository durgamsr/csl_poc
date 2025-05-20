// Utility function to safely log token information
const logTokenInfo = (tokenSet) => {
    try {
        if (!tokenSet) {
            console.log('No token set available');
            return;
        }
        
        console.log('=== TOKEN INFO ===');
        console.log('Token type:', typeof tokenSet);
        
        let claims = null;
        
        // Handle different token formats
        if (typeof tokenSet.claims === 'function') {
            // OpenID Connect standard format
            console.log('Token format: OpenID Connect (claims function)');
            claims = tokenSet.claims();
        } else if (tokenSet.id_token_payload) {
            // Some JWT libraries format
            console.log('Token format: JWT with id_token_payload');
            claims = tokenSet.id_token_payload;
        } else if (tokenSet.decoded) {
            // Decoded JWT format
            console.log('Token format: JWT with decoded structure');
            claims = tokenSet.decoded.payload;
        } else if (tokenSet.id_token && typeof tokenSet.id_token === 'string') {
            // Raw JWT format
            console.log('Token format: Raw JWT string');
            const parts = tokenSet.id_token.split('.');
            if (parts.length === 3) {
                try {
                    claims = JSON.parse(Buffer.from(parts[1], 'base64').toString());
                } catch (e) {
                    console.error('Error decoding JWT payload:', e);
                }
            }
        }
        
        if (!claims) {
            console.log('No token claims could be extracted. Available token properties:');
            console.log(Object.keys(tokenSet));
            return;
        }
        
        console.log('=== TOKEN CLAIMS ===');
        console.log(JSON.stringify(claims, null, 2));
        
        // Highlight important claims
        if (claims['cognito:username']) {
            console.log(`Cognito Username: ${claims['cognito:username']}`);
        } else if (claims.username) {
            console.log(`Username: ${claims.username}`);
        }
        
        if (claims.email) {
            console.log(`Email: ${claims.email}`);
        }
        
        if (claims.exp) {
            const expiryTime = new Date(claims.exp * 1000);
            const now = new Date();
            const timeLeft = (expiryTime - now) / 1000 / 60; // minutes left
            console.log(`Token expires at: ${expiryTime}, Minutes left: ${timeLeft.toFixed(2)}`);
        }
        
        // Check for access token
        if (tokenSet.access_token) {
            console.log('Access token available (not shown for security)');
            console.log('Access token length:', tokenSet.access_token.length);
        } else {
            console.log('No access token found in tokenSet');
        }
        
        console.log('=== END TOKEN INFO ===');
    } catch (error) {
        console.error('Error logging token info:', error);
    }
};

module.exports = {
    logTokenInfo
}; 