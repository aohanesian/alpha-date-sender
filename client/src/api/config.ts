import axios from 'axios'

// Alpha Date API configuration
export const alphaDateApi = axios.create({
  baseURL: 'https://alpha.date/api',
  headers: {
    'Content-Type': 'application/json',
  },
})

// Our backend API configuration
const api = axios.create({
  baseURL: 'http://localhost:3001/api',
  headers: {
    'Content-Type': 'application/json',
  },
})

// Add a request interceptor to add the auth token to requests
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

export default api 