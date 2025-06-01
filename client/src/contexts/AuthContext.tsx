import React, { createContext, useContext, useState, useEffect } from 'react';

interface User {
  operatorId: string;
  email: string;
  token: string;
  alphaDateToken: string;
  profiles: string[];
}

interface AuthContextType {
  user: User | null;
  login: (userData: User) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const savedUser = localStorage.getItem('user');
      if (savedUser) {
        const parsedUser = JSON.parse(savedUser);
        console.log('Retrieved user from localStorage:', parsedUser);
        return parsedUser;
      }
    } catch (error) {
      console.error('Error parsing user from localStorage:', error);
    }
    return null;
  });

  useEffect(() => {
    if (user) {
      console.log('Saving user to localStorage:', user);
      localStorage.setItem('user', JSON.stringify(user));
    } else {
      console.log('Removing user from localStorage');
      localStorage.removeItem('user');
    }
  }, [user]);

  const login = (userData: User) => {
    console.log('Login called with user data:', userData);
    setUser(userData);
  };

  const logout = () => {
    console.log('Logout called');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}; 