const { logTokenInfo } = require('../utils/logger');

// Authentication check middleware
const checkAuth = (req, res, next) => {
    if (!req.session.userInfo) {
        req.isAuthenticated = false;
    } else {
        req.isAuthenticated = true;
    }
    next();
};

// Authentication required middleware
const requireAuth = (req, res, next) => {
    if (!req.session.isAuthenticated || !req.session.userInfo) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    next();
};

// Update token info middleware - ensures username from cognito:username is set
const updateTokenInfo = (req, res, next) => {
    if (req.session.isAuthenticated && req.session.tokenSet) {
        try {
            let idTokenPayload = null;
            
            // Check if tokenSet.claims is a function (openid-client format)
            if (req.session.tokenSet.claims && typeof req.session.tokenSet.claims === 'function') {
                idTokenPayload = req.session.tokenSet.claims();
            } 
            // Check if tokenSet has id_token_payload (older JWT format)
            else if (req.session.tokenSet.id_token_payload) {
                idTokenPayload = req.session.tokenSet.id_token_payload;
            }
            // Check if tokenSet has decoded format
            else if (req.session.tokenSet.decoded) {
                idTokenPayload = req.session.tokenSet.decoded.payload;
            }
            // Parse id_token directly if available
            else if (req.session.tokenSet.id_token && typeof req.session.tokenSet.id_token === 'string') {
                const parts = req.session.tokenSet.id_token.split('.');
                if (parts.length === 3) {
                    try {
                        idTokenPayload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
                    } catch (e) {
                        console.error('Error decoding JWT payload:', e);
                    }
                }
            }
            
            // If we have a payload and it contains the cognito username
            if (idTokenPayload && idTokenPayload['cognito:username'] && 
                req.session.userInfo && 
                (!req.session.userInfo.username || req.session.userInfo.username !== idTokenPayload['cognito:username'])) {
                req.session.userInfo.username = idTokenPayload['cognito:username'];
                console.log(`Updated username to: ${req.session.userInfo.username}`);
            }
        } catch (error) {
            console.error('Error processing token in middleware:', error);
            // Continue with request even if token processing fails
        }
    }
    next();
};

module.exports = {
    checkAuth,
    requireAuth,
    updateTokenInfo
}; 