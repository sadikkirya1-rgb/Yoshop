export function getAuthErrorMessage(error) {
  const code = error?.code || '';
  const message = error?.message || '';

  if (code === 'auth/invalid-credential' || code === 'auth/user-not-found' || code === 'auth/wrong-password') {
    return {
      title: 'Login Failed',
      message: 'This email/password sign-in failed. The account may not exist yet, the password may be wrong, or the account may use Google sign-in only. Try Google sign-in or create/register a password-based account.'
    };
  }

  if (code === 'auth/operation-not-allowed') {
    return {
      title: 'Email Login Disabled',
      message: 'Email/Password sign-in is not enabled for this Firebase project. Please enable it in Firebase Console > Authentication > Sign-in method.'
    };
  }

  if (code === 'auth/network-request-failed') {
    return {
      title: 'Network Error',
      message: 'Unable to reach Firebase. Please check your internet connection and try again.'
    };
  }

  if (code === 'auth/too-many-requests') {
    return {
      title: 'Too Many Attempts',
      message: 'Too many login attempts were made. Please wait a moment and try again.'
    };
  }

  return {
    title: 'Login Failed',
    message: message || 'Unable to sign in. Please try again or use Google sign-in.'
  };
}
