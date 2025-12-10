import fs from 'fs';

export class ValidationUtils {
    static validateOptions(options, schema) {
        const errors = [];

        for (const [key, rules] of Object.entries(schema)) {
            const value = options[key];

            if (rules.required && (value === undefined || value === null)) {
                errors.push(`${key} is required`);
                continue;
            }

            if (value !== undefined && rules.type && typeof value !== rules.type) {
                errors.push(`${key} must be of type ${rules.type}`);
            }

            if (rules.validate && !rules.validate(value)) {
                errors.push(`${key} validation failed`);
            }
        }

        return errors;
    }

    static isValidRegex(pattern) {
        try {
            new RegExp(pattern);
            return true;
        } catch {
            return false;
        }
    }

    static isValidDirectory(dirPath) {
        try {
            return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
        } catch {
            return false;
        }
    }
}