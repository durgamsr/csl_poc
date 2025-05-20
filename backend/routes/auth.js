// backend/routes/auth.js

const express = require('express');
const router = express.Router();
const { generators } = require('openid-client');
const { checkAuth, updateTokenInfo } = require('../middleware/auth');
const cognitoService = require('../services/cognitoService');
const s3Service = require('../services/s3Service');
const { logTokenInfo } = require('../utils/logger');

// Home route
router.get('/', checkAuth, (req, res) => {
    res.render('home', {
        isAuthenticated: req.isAuthenticated,
        userInfo: req.session.userInfo
    });
});

// Login route
router.get('/login', (req, res) => {
    const nonce = generators.nonce();
    const state = generators.state();

    req.session.nonce = nonce;
    req.session.state = state;

    const authUrl = cognitoService.getAuthorizationUrl(nonce, state);
    res.redirect(authUrl);
});

// Callback route
router.get('/callback', async (req, res) => {
    try {
        const params = cognitoService.client().callbackParams(req);
        
        // Check if we have the required parameters
        if (!params.code || !params.state) {
            console.error('Missing required parameters:', params);
            return res.redirect('/');
        }

        // Verify state matches what we stored
        if (params.state !== req.session.state) {
            console.error('State mismatch');
            return res.redirect('/');
        }

        // Process the callback
        const { userInfo, tokenSet } = await cognitoService.processCallback(params, req.session);
        
        // Store user info and token set in session
        req.session.userInfo = userInfo;
        req.session.tokenSet = tokenSet;
        req.session.isAuthenticated = true;
        
        // Create a folder for the user in S3 if they don't have one
        if (req.session.userInfo && req.session.userInfo.username) {
            try {
                // Check if user folder already exists
                const folderExists = await s3Service.checkUserFolderExists(req.session.userInfo.username);
                
                if (!folderExists) {
                    // Create a folder for the user
                    await s3Service.createUserFolder(req.session.userInfo.username);
                }
            } catch (error) {
                console.error('Error handling user folder:', error);
                // Continue with login even if folder creation fails
            }
        }
        
        // Redirect to frontend file upload page
        res.redirect('http://localhost:3000/');
    } catch (err) {
        console.error('Callback error:', err);
        // Clear session on error
        req.session.destroy();
        res.redirect('/');
    }
});

// Check authentication status
router.get('/check-auth', updateTokenInfo, (req, res) => {
    if (req.session.isAuthenticated) {
        // Log token information
        if (req.session.tokenSet) {
            console.log('Logging token info from check-auth:');
            logTokenInfo(req.session.tokenSet);
        }
        
        res.json({ 
            isAuthenticated: true, 
            user: req.session.userInfo 
        });
    } else {
        res.json({ isAuthenticated: false });
    }
});

// Logout route
router.get('/logout', (req, res) => {
    // Get the logout URL
    const logoutUrl = cognitoService.getLogoutUrl();
    
    // Destroy the session
    req.session.destroy();
    
    console.log('Redirecting to logout URL:', logoutUrl);
    res.redirect(logoutUrl);
});

// Debug endpoint to inspect token claims
router.get('/debug-token', (req, res) => {
    try {
        if (!req.session || !req.session.tokenSet) {
            return res.json({ error: 'No token available' });
        }
        
        let claims = null;
        
        // Extract claims using all available methods
        if (req.session.tokenSet.claims && typeof req.session.tokenSet.claims === 'function') {
            claims = req.session.tokenSet.claims();
        } else if (req.session.tokenSet.id_token_payload) {
            claims = req.session.tokenSet.id_token_payload;
        } else if (req.session.tokenSet.decoded) {
            claims = req.session.tokenSet.decoded.payload;
        } else if (req.session.tokenSet.id_token && typeof req.session.tokenSet.id_token === 'string') {
            const parts = req.session.tokenSet.id_token.split('.');
            if (parts.length === 3) {
                try {
                    claims = JSON.parse(Buffer.from(parts[1], 'base64').toString());
                } catch (e) {
                    return res.json({ error: 'Error decoding JWT payload', details: e.message });
                }
            }
        }
        
        if (!claims) {
            return res.json({ 
                error: 'No claims found', 
                tokenProperties: Object.keys(req.session.tokenSet),
                tokenType: typeof req.session.tokenSet
            });
        }
        
        res.json({
            claims: claims,
            hasUsername: Boolean(claims['cognito:username']),
            hasEmail: Boolean(claims.email),
            hasSub: Boolean(claims.sub),
            tokenProperties: Object.keys(req.session.tokenSet)
        });
    } catch (error) {
        res.json({ error: 'Error inspecting token', details: error.message });
    }
});

module.exports = router; 