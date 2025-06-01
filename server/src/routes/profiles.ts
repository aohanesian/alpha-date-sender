import { Router } from 'express';
import axios from 'axios';
import { AppError } from '../middleware/errorHandler';
import { auth } from '../middleware/auth';
import { getProfiles, updateProfile } from '../controllers/profiles';

const router = Router();

interface Profile {
  id: number;
  name: string;
  external_id: string;
  photo_link: string;
  city: string;
  agency_id: number;
  online: number;
  gifts: number;
  contact: number;
  meeting: number;
  webcam: number;
  man_profile: number;
  site_ids: string[];
  age: number;
  country_name: string;
  country_code: string;
  country_image: string;
  region: string;
}

interface Folder {
  name: string;
  list: any[];
}

// Get profiles
router.get('/', auth, getProfiles);

// Get attachments
router.get('/:profileId/attachments', async (req, res, next) => {
  try {
    const { profileId } = req.params;
    const { forceRefresh } = req.query;
    const alphaDateToken = req.headers['x-alpha-date-token'];

    if (!alphaDateToken) {
      throw new AppError('Alpha Date token is required', 401);
    }

    const types = ['images', 'videos', 'audios'];
    const attachments: Record<string, any[]> = {};

    for (const type of types) {
      const response = await axios.get(
        `${process.env.ALPHA_DATE_API_URL}/files/${type}?external_id=${profileId}${forceRefresh === 'true' ? '&force_refresh=true' : ''}`,
        {
          headers: {
            'Authorization': `Bearer ${alphaDateToken}`
          }
        }
      );

      if (response.data.folders && typeof response.data.folders === 'object') {
        const sendFolder = Object.values(response.data.folders).find((folder: unknown) => 
          (folder as Folder).name?.toLowerCase() === "send"
        ) as Folder | undefined;

        if (sendFolder && Array.isArray(sendFolder.list)) {
          attachments[type] = sendFolder.list;
        } else {
          attachments[type] = [];
        }
      } else if (response.data[type] && Array.isArray(response.data[type])) {
        attachments[type] = response.data[type];
      } else if (response.data.response && Array.isArray(response.data.response)) {
        attachments[type] = response.data.response;
      } else {
        attachments[type] = [];
      }
    }

    res.json(attachments);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      next(new AppError(error.response?.data?.message || 'Failed to fetch attachments', error.response?.status || 500));
    } else {
      next(error);
    }
  }
});

router.put('/:id', auth, updateProfile);

export { router as profilesRouter }; 