import React, { createContext, useContext, ReactNode } from 'react';
import { Session, User, AuthError } from '@supabase/supabase-js';
import { useAuth } from '../hooks/useAuth';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  initialized: boolean;
  loading: boolean;
  isAuthenticated: boolean;
  signUp: (email: string, password: string) => Promise<{
    error: AuthError | null;
    needsEmailConfirmation: boolean;
  }>;
  signIn: (email: string, password: string) => Promise<{
    error: AuthError | null;
  }>;
  signOut: () => Promise<{ error: AuthError | null }>;
  resetPassword: (email: string) => Promise<{ error: AuthError | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const auth = useAuth();

  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
}
