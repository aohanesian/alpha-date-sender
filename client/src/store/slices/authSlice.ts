import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

interface AuthState {
  token: string | null;
  alphaDateToken: string | null;
  operatorId: string | null;
  loading: boolean;
  error: string | null;
}

// Load initial state from localStorage
const loadInitialState = (): AuthState => {
  try {
    const savedState = localStorage.getItem('authState');
    if (savedState) {
      const parsedState = JSON.parse(savedState);
      return {
        ...parsedState,
        loading: false,
        error: null
      };
    }
  } catch (error) {
    console.error('Error loading auth state from localStorage:', error);
  }
  return {
    token: null,
    alphaDateToken: null,
    operatorId: null,
    loading: false,
    error: null,
  };
};

const initialState: AuthState = loadInitialState();

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    login: (state, action: PayloadAction<{ token: string; alphaDateToken: string; operatorId: string }>) => {
      state.token = action.payload.token;
      state.alphaDateToken = action.payload.alphaDateToken;
      state.operatorId = action.payload.operatorId;
      state.error = null;
      
      // Save to localStorage
      localStorage.setItem('authState', JSON.stringify({
        token: action.payload.token,
        alphaDateToken: action.payload.alphaDateToken,
        operatorId: action.payload.operatorId
      }));
    },
    logout: (state) => {
      state.token = null;
      state.alphaDateToken = null;
      state.operatorId = null;
      state.error = null;
      
      // Clear localStorage
      localStorage.removeItem('authState');
    },
    setError: (state, action: PayloadAction<string>) => {
      state.error = action.payload;
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
  },
});

export const { login, logout, setError, setLoading } = authSlice.actions;
export default authSlice.reducer; 