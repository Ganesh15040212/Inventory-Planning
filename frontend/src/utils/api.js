import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
});

// Attach JWT token automatically
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('inv_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Handle 401 or 403 globally (token expired or invalid)
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 || err.response?.status === 403) {
      // Only redirect if not already on the login page to prevent infinite reload loops
      if (!window.location.pathname.startsWith('/login')) {
        localStorage.removeItem('inv_token');
        localStorage.removeItem('inv_user');
        window.location.replace('/login');
      }
    }
    return Promise.reject(err);
  }
);

export default api;
