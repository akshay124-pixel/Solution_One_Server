# 🌍 Frontend Integration Guide (Vercel + React/Next.js)

## 📋 Overview

Your React/Next.js frontend on Vercel will communicate with your backend through:
- **HTTP API**: `https://srv988392.hstgr.cloud/api/`
- **WebSocket**: `https://srv988392.hstgr.cloud/crm/socket.io`

---

## Step 1️⃣: Setup Environment Variables in Vercel

### Add to Vercel Project Settings:

**Go to:** Dashboard → Project → Settings → Environment Variables

```
REACT_APP_API_URL=https://srv988392.hstgr.cloud
REACT_APP_SOCKET_URL=https://srv988392.hstgr.cloud
REACT_APP_JWT_TOKEN_KEY=access_token
REACT_APP_REFRESH_TOKEN_KEY=refresh_token
REACT_APP_FRONTEND_URL=https://yourfrontend.vercel.app
```

### For Different Environments:
```
# Production
REACT_APP_API_URL=https://srv988392.hstgr.cloud

# Preview (Optional)
REACT_APP_API_URL=https://srv988392.hstgr.cloud

# Development (Local)
# Add in .env.local (NOT in Vercel)
REACT_APP_API_URL=http://localhost:5050
```

---

## Step 2️⃣: Create API Client

### `src/api/client.js`

```javascript
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5050';

// ===== HTTP CLIENT =====
export const apiClient = axios.create({
  baseURL: API_URL,
  timeout: 30000,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ===== REQUEST INTERCEPTOR (Add Token) =====
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem(process.env.REACT_APP_JWT_TOKEN_KEY || 'access_token');
    
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// ===== RESPONSE INTERCEPTOR (Handle Auth Errors) =====
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // If 401 and not already retried, try to refresh token
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshToken = localStorage.getItem(
          process.env.REACT_APP_REFRESH_TOKEN_KEY || 'refresh_token'
        );

        if (refreshToken) {
          const response = await axios.post(
            `${API_URL}/api/auth/refresh`,
            { refreshToken },
            { withCredentials: true }
          );

          const { token } = response.data;
          localStorage.setItem(process.env.REACT_APP_JWT_TOKEN_KEY || 'access_token', token);

          // Retry original request with new token
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return apiClient(originalRequest);
        }
      } catch (refreshError) {
        // Refresh failed - logout user
        localStorage.removeItem(process.env.REACT_APP_JWT_TOKEN_KEY || 'access_token');
        localStorage.removeItem(process.env.REACT_APP_REFRESH_TOKEN_KEY || 'refresh_token');
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

// ===== API ENDPOINTS =====
export const apiEndpoints = {
  // ========== AUTHENTICATION ==========
  auth: {
    login: (credentials) => apiClient.post('/api/auth/login', credentials),
    signup: (userData) => apiClient.post('/api/auth/signup', userData),
    logout: () => apiClient.post('/api/auth/logout'),
    refreshToken: (refreshToken) => 
      apiClient.post('/api/auth/refresh', { refreshToken }),
    verifyToken: () => apiClient.get('/api/auth/verify'),
    changePassword: (passwords) => 
      apiClient.post('/api/auth/change-password', passwords),
  },

  // ========== CRM MODULE ==========
  crm: {
    // Data endpoints
    getData: () => apiClient.get('/api/crm/api/data'),
    createData: (data) => apiClient.post('/api/crm/api/create', data),
    updateData: (id, data) => apiClient.put(`/api/crm/api/${id}`, data),
    deleteData: (id) => apiClient.delete(`/api/crm/api/${id}`),
    
    // Attendance
    getAttendance: () => apiClient.get('/api/crm/api/attendance'),
    markAttendance: (data) => apiClient.post('/api/crm/api/attendance', data),
    
    // Notifications
    getNotifications: () => apiClient.get('/api/crm/api/notifications'),
    markNotificationRead: (id) => 
      apiClient.put(`/api/crm/api/notifications/${id}/read`),
  },

  // ========== DMS MODULE ==========
  dms: {
    getData: () => apiClient.get('/api/dms/api/data'),
    getDialerStatus: () => apiClient.get('/api/dms/dialer/status'),
    makeCall: (phoneNumber) => apiClient.post('/api/dms/dialer/call', { phoneNumber }),
    getCallHistory: () => apiClient.get('/api/dms/calls/history'),
    getAnalytics: () => apiClient.get('/api/dms/analytics/data'),
    getRecordings: () => apiClient.get('/api/dms/recordings'),
  },

  // ========== SALES ORDER (SO) MODULE ==========
  so: {
    getData: () => apiClient.get('/api/so/api/data'),
    createOrder: (data) => apiClient.post('/api/so/api/create', data),
    getOrders: () => apiClient.get('/api/so/api/orders'),
    updateOrder: (id, data) => apiClient.put(`/api/so/api/${id}`, data),
  },

  // ========== FURNITURE (FURNI) MODULE ==========
  furni: {
    getData: () => apiClient.get('/api/furni/api/data'),
    getInventory: () => apiClient.get('/api/furni/api/inventory'),
  },

  // ========== FILE UPLOADS ==========
  uploads: {
    uploadCRM: (file) => {
      const formData = new FormData();
      formData.append('file', file);
      return apiClient.post('/api/crm/api/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    uploadDMS: (file) => {
      const formData = new FormData();
      formData.append('file', file);
      return apiClient.post('/api/dms/api/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
  },
};

export default apiClient;
```

---

## Step 3️⃣: Setup Socket.IO Client

### `src/api/socket.js`

```javascript
import io from 'socket.io-client';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:5050';

let socket = null;

export const initializeSocket = (jwtToken) => {
  if (socket?.connected) {
    return socket;
  }

  socket = io(SOCKET_URL, {
    path: '/crm/socket.io',
    auth: {
      token: `Bearer ${jwtToken}`,
    },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5,
    transports: ['websocket', 'polling'],
  });

  // ===== EVENT HANDLERS =====
  socket.on('connect', () => {
    console.log('✅ Connected to CRM Server');
  });

  socket.on('disconnect', () => {
    console.log('❌ Disconnected from CRM Server');
  });

  socket.on('connect_error', (error) => {
    console.error('🔴 Socket Connection Error:', error);
  });

  socket.on('error', (error) => {
    console.error('🔴 Socket Error:', error);
  });

  // ===== CRM SPECIFIC EVENTS =====
  socket.on('notification', (data) => {
    console.log('📬 New Notification:', data);
    // Trigger notification UI update
    // Example: dispatch(addNotification(data))
  });

  socket.on('attendance_update', (data) => {
    console.log('📋 Attendance Update:', data);
  });

  socket.on('user_status_changed', (data) => {
    console.log('👤 User Status Changed:', data);
  });

  socket.on('meeting_scheduled', (data) => {
    console.log('📅 Meeting Scheduled:', data);
  });

  return socket;
};

export const disconnectSocket = () => {
  if (socket?.connected) {
    socket.disconnect();
    socket = null;
  }
};

export const getSocket = () => socket;

// ===== EMIT EVENTS =====
export const socketEmit = {
  // Send to server
  notification: (data) => socket?.emit('notification', data),
  updateAttendance: (data) => socket?.emit('attendance_update', data),
  changeUserStatus: (status) => socket?.emit('user_status_changed', { status }),
  
  // Custom events
  customEvent: (eventName, data) => socket?.emit(eventName, data),
};

export default socket;
```

---

## Step 4️⃣: Create Auth Hook

### `src/hooks/useAuth.js`

```javascript
import { useState, useEffect, useContext, createContext } from 'react';
import { apiEndpoints } from '@/api/client';
import { initializeSocket, disconnectSocket } from '@/api/socket';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [socket, setSocket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Check if user is logged in on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const token = localStorage.getItem('access_token');
        if (token) {
          // Verify token is still valid
          const response = await apiEndpoints.auth.verifyToken();
          setUser(response.data.user);
          
          // Initialize Socket.IO
          const socketInstance = initializeSocket(token);
          setSocket(socketInstance);
        }
      } catch (error) {
        console.error('Auth check failed:', error);
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  const login = async (email, password) => {
    try {
      setError(null);
      const response = await apiEndpoints.auth.login({ email, password });
      
      const { token, refreshToken, user } = response.data;
      
      // Store tokens
      localStorage.setItem('access_token', token);
      localStorage.setItem('refresh_token', refreshToken);
      
      // Set user
      setUser(user);
      
      // Initialize Socket.IO
      const socketInstance = initializeSocket(token);
      setSocket(socketInstance);
      
      return { success: true };
    } catch (err) {
      const message = err.response?.data?.message || 'Login failed';
      setError(message);
      return { success: false, error: message };
    }
  };

  const logout = async () => {
    try {
      await apiEndpoints.auth.logout();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      // Clear localStorage
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      
      // Disconnect socket
      disconnectSocket();
      
      // Clear state
      setUser(null);
      setSocket(null);
    }
  };

  const signup = async (userData) => {
    try {
      setError(null);
      const response = await apiEndpoints.auth.signup(userData);
      
      const { token, refreshToken, user } = response.data;
      
      localStorage.setItem('access_token', token);
      localStorage.setItem('refresh_token', refreshToken);
      
      setUser(user);
      
      const socketInstance = initializeSocket(token);
      setSocket(socketInstance);
      
      return { success: true };
    } catch (err) {
      const message = err.response?.data?.message || 'Signup failed';
      setError(message);
      return { success: false, error: message };
    }
  };

  const value = {
    user,
    socket,
    loading,
    error,
    login,
    logout,
    signup,
    isAuthenticated: !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
```

---

## Step 5️⃣: Setup in Your App

### `src/App.js` (or `pages/_app.js` for Next.js)

```javascript
import { AuthProvider } from '@/hooks/useAuth';
import Router from '@/routes';

function App() {
  return (
    <AuthProvider>
      <Router />
    </AuthProvider>
  );
}

export default App;
```

### Protected Route Component: `src/components/ProtectedRoute.js`

```javascript
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

export const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
};
```

---

## Step 6️⃣: Login Page Example

### `src/pages/Login.js`

```javascript
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

export const Login = () => {
  const navigate = useNavigate();
  const { login, error } = useAuth();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    const result = await login(email, password);
    
    setLoading(false);

    if (result.success) {
      navigate('/dashboard');
    }
  };

  return (
    <div className="login-container">
      <h1>Login</h1>
      {error && <div className="error">{error}</div>}
      
      <form onSubmit={handleSubmit}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          required
        />
        
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          required
        />
        
        <button type="submit" disabled={loading}>
          {loading ? 'Logging in...' : 'Login'}
        </button>
      </form>
    </div>
  );
};
```

---

## Step 7️⃣: Socket.IO Event Listeners

### Example: Real-time Notifications

```javascript
import { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';

export const NotificationListener = () => {
  const { socket } = useAuth();

  useEffect(() => {
    if (!socket) return;

    // Listen for notifications
    socket.on('notification', (data) => {
      console.log('New notification:', data);
      // Show toast/notification UI
      showNotification(data.message, data.type);
    });

    // Cleanup
    return () => {
      socket.off('notification');
    };
  }, [socket]);

  return null; // This is a non-visual component
};
```

---

## Step 8️⃣: CORS Configuration (Backend)

Your backend already has CORS configured, but verify:

In `index.js`:
```javascript
const allowedOrigins = [
  process.env.UNIFIED_CLIENT_URL || "http://localhost:3000",
];

app.use(cors({
  origin: allowedOrigins,
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"],
  credentials: true,
}));
```

Make sure `UNIFIED_CLIENT_URL` in `.env` matches your Vercel URL:
```
UNIFIED_CLIENT_URL=https://yourfrontend.vercel.app
```

---

## Step 9️⃣: Testing the Integration

### Test Login
```javascript
// In browser console
const loginRes = await fetch('https://srv988392.hstgr.cloud/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'test@example.com',
    password: 'password'
  })
});
const data = await loginRes.json();
console.log(data); // Should return token
```

### Test Socket.IO
```javascript
// In browser console
import io from 'socket.io-client';
const socket = io('https://srv988392.hstgr.cloud', {
  path: '/crm/socket.io',
  auth: { token: 'Bearer YOUR_JWT_TOKEN' }
});
socket.on('connect', () => console.log('Connected!'));
```

---

## 🆘 Common Problems & Solutions

| Problem | Solution |
|---------|----------|
| CORS error | Verify `UNIFIED_CLIENT_URL` contains your domain in `.env` |
| 401 Unauthorized | Token expired. Refresh token or login again |
| Socket.IO not connecting | Check `/crm/socket.io` path and auth token |
| Network timeout | Verify backend is running: `curl https://srv988392.hstgr.cloud/health` |
| Blank page after login | Check browser console for API errors |

---

## 📡 Environment Variables for Vercel

Finally,  in Vercel project settings add:

```env
# Production
REACT_APP_API_URL = https://srv988392.hstgr.cloud
REACT_APP_SOCKET_URL = https://srv988392.hstgr.cloud
REACT_APP_JWT_TOKEN_KEY = access_token
REACT_APP_REFRESH_TOKEN_KEY = refresh_token
REACT_APP_FRONTEND_URL = https://yourfrontend.vercel.app

# Optional: For preview deployments
REACT_APP_API_URL_PREVIEW = https://srv988392.hstgr.cloud
```

Then redeploy your Vercel app.

---

**🎉 Your frontend is now integrated with the backend!**

See [DEPLOYMENT_GUIDE_HINGLISH.md](./DEPLOYMENT_GUIDE_HINGLISH.md) for full backend deployment guide.
