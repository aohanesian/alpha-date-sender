import axios from 'axios';

interface WhitelistResponse {
  documents: Array<{
    fields: {
      email: {
        arrayValue: {
          values: Array<{
            stringValue: string;
          }>;
        };
      };
    };
  }>;
}

export const getWhitelistedEmails = async (): Promise<string[]> => {
  try {
    // Fetch from first whitelist
    const whitelistResponse1 = await axios.get<WhitelistResponse>(
      'https://firestore.googleapis.com/v1/projects/alpha-a4fdc/databases/(default)/documents/operator_whitelist'
    );

    // Fetch from second whitelist
    const whitelistResponse2 = await axios.get<WhitelistResponse>(
      'https://firestore.googleapis.com/v1/projects/alpha-date-sender/databases/(default)/documents/operator_whitelist'
    );

    // Combine emails from both whitelists
    const emails1 = whitelistResponse1.data.documents?.[0]?.fields?.email?.arrayValue?.values?.map(
      item => item.stringValue.toLowerCase()
    ) || [];

    const emails2 = whitelistResponse2.data.documents?.[0]?.fields?.email?.arrayValue?.values?.map(
      item => item.stringValue.toLowerCase()
    ) || [];

    // Combine and remove duplicates
    return [...new Set([...emails1, ...emails2])];
  } catch (error) {
    console.error('Error fetching whitelists:', error);
    return [];
  }
}; 