import { useEffect, useState, useCallback } from 'react';
import { Session, User, AuthError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface AuthState {
  user: User | null;
  session: Session | null;
  initialized: boolean;
  loading: boolean;
}

interface SignUpResult {
  error: AuthError | null;
  needsEmailConfirmation: boolean;
}

interface SignInResult {
  error: AuthError | null;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    initialized: false,
    loading: true,
  });

  useEffect(() => {
    // Get initial session
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        setState({
          user: session?.user ?? null,
          session,
          initialized: true,
          loading: false,
        });
      })
      .catch(() => {
        // Network error — still mark as initialized so the app can proceed
        setState({
          user: null,
          session: null,
          initialized: true,
          loading: false,
        });
      });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setState((prev) => ({
        ...prev,
        user: session?.user ?? null,
        session,
        initialized: true,
        loading: false,
      }));
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signUp = useCallback(
    async (email: string, password: string): Promise<SignUpResult> => {
      setState((prev) => ({ ...prev, loading: true }));

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      setState((prev) => ({ ...prev, loading: false }));

      if (error) {
        return { error, needsEmailConfirmation: false };
      }

      // Check if email confirmation is required
      const needsEmailConfirmation = !data.session && !!data.user;

      return { error: null, needsEmailConfirmation };
    },
    []
  );

  const signIn = useCallback(
    async (email: string, password: string): Promise<SignInResult> => {
      setState((prev) => ({ ...prev, loading: true }));

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      setState((prev) => ({ ...prev, loading: false }));

      return { error };
    },
    []
  );

  const signOut = useCallback(async (): Promise<{ error: AuthError | null }> => {
    setState((prev) => ({ ...prev, loading: true }));

    const { error } = await supabase.auth.signOut();

    setState((prev) => ({ ...prev, loading: false }));

    return { error };
  }, []);

  const resetPassword = useCallback(
    async (email: string): Promise<{ error: AuthError | null }> => {
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      return { error };
    },
    []
  );

  return {
    user: state.user,
    session: state.session,
    initialized: state.initialized,
    loading: state.loading,
    isAuthenticated: !!state.session,
    signUp,
    signIn,
    signOut,
    resetPassword,
  };
}
