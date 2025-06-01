import fs from 'fs';
import path from 'path';

export const getWhitelistedEmails = async (): Promise<string[]> => {
  try {
    const whitelistPath = path.join(__dirname, '../../config/whitelist.json');
    const whitelistData = await fs.promises.readFile(whitelistPath, 'utf-8');
    const whitelist = JSON.parse(whitelistData);
    return whitelist.emails.map((email: string) => email.toLowerCase());
  } catch (error) {
    console.error('Error reading whitelist:', error);
    return [];
  }
}; 