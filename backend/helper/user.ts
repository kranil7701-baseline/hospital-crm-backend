export const validatePassword = (password: string): string | null => {
    if (!password) return 'Password is required';
    if (password.length < 8) return 'Password must be at least 8 characters long';
    if (!/[a-z]/.test(password)) return 'Password must include at least one lowercase letter';
    if (!/[A-Z]/.test(password)) return 'Password must include at least one uppercase letter';
    if (!/\d/.test(password)) return 'Password must include at least one number';
    if (!/[@$!%*?&#]/.test(password)) return 'Password must include at least one special character (@$!%*?&#)';

    return null;
};


export const validateEmail = (email: string): string | null => {
    const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;

    if (!email) return 'Email is required';
    if (!emailRegex.test(email)) return 'Please enter a valid email';

    return null;
};