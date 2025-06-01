import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

export interface Profile {
  id: number;
  name: string;
  external_id: string;
  photo_link: string;
  age: number;
  gender: string;
  country_name: string;
  status: string;
}

export interface ProfilesState {
  items: Profile[];
  loading: boolean;
  error: string | null;
  selectedProfile: Profile | null;
}

const initialState: ProfilesState = {
  items: [],
  loading: false,
  error: null,
  selectedProfile: null,
};

const profilesSlice = createSlice({
  name: 'profiles',
  initialState,
  reducers: {
    setProfiles: (state, action: PayloadAction<Profile[]>) => {
      state.items = Array.isArray(action.payload) ? action.payload : [];
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
    setSelectedProfile: (state, action: PayloadAction<Profile | null>) => {
      state.selectedProfile = action.payload;
    },
  },
});

export const { setProfiles, setLoading, setError, setSelectedProfile } = profilesSlice.actions;
export default profilesSlice.reducer; 