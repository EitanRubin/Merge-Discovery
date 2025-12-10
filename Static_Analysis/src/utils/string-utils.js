export class StringUtils {
    static looksLikeUrl(str) {
        if (typeof str !== 'string') return false;

        // HTTP/HTTPS URLs
        if (/^https?:\/\/.+/i.test(str)) return true;

        return false;
    }
    
    static looksLikeProtocolUrl(str){
        if (typeof str !== 'string') return false;
        
        // Protocol-relative URLs
        if (/^\/\/.+/.test(str)) return true;
      
        return false;
    }
    
    static looksLikePath(str){
        if(typeof str !== 'string') return false;
        
        // Absolute paths that might be API endpoints
        if (/^\/api\//.test(str)) return true;
    
        // Relative paths that look like API endpoints
        if (/^api\//.test(str)) return true;
    
        // Other URL patterns
        if (/^\/[a-zA-Z0-9]/.test(str) && str.includes('/')) return true;

        return false;
    }

    static extractDomain(url) {
        try {
            const urlObj = new URL(url.startsWith('http') ? url : `http://${url}`);
            return urlObj.hostname;
        } catch {
            return null;
        }
    }

    static isLocalhost(url) {
        const patterns = [
            /localhost/,
            /127\.0\.0\.1/,
            /0\.0\.0\.0/,
            /::1/
        ];
        return patterns.some(pattern => pattern.test(url))
    }

    static isPrivateIP(url) {
        const privatePatterns = [
            /192\.168\./,
            /10\./,
            /172\.(1[6-9]|2[0-9]|3[01])\./
        ];
        return privatePatterns.some(pattern => pattern.test(url));
    }

    static sanitizeFileName(fileName) {
        return fileName.replace(/[^a-z0-9.-]/gi, '_').toLowerCase();
    }
}