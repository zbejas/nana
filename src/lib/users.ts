import { pb } from './pocketbase';
import type { RecordModel } from 'pocketbase';
import { createLogger } from './logger';

const logger = createLogger('Users');

export interface User extends RecordModel {
    email: string;
    name: string;
    avatar?: string;
    admin: boolean;
    verified: boolean;
    created: string;
    updated: string;
}

// List all users (admin only)
export async function listUsers(options?: {
    page?: number;
    perPage?: number;
    sort?: string;
}): Promise<{ items: User[]; totalItems: number; totalPages: number }> {
    try {
        logger.debug('Fetching users', options);

        const result = await pb.collection('users').getList<User>(
            options?.page || 1,
            options?.perPage || 50,
            {
                sort: options?.sort || '-created',
            }
        );

        logger.debug('Users fetched', { total: result.items.length });

        return {
            items: result.items,
            totalItems: result.totalItems,
            totalPages: result.totalPages,
        };
    } catch (error: any) {
        logger.error('Failed to fetch users', {
            status: error.status,
            message: error.message,
        });
        throw error;
    }
}

// Create a new user (admin only)
export async function createUser(data: {
    email: string;
    password: string;
    name: string;
    admin?: boolean;
}): Promise<User> {
    try {
        logger.debug('Creating user', { email: data.email });

        const userData = {
            email: data.email,
            password: data.password,
            passwordConfirm: data.password,
            name: data.name,
            admin: data.admin || false,
            emailVisibility: true, // Make email visible in dashboard
            // Note: verified field is managed by PocketBase's email verification system
            // Admin-created users will need to verify their email via the verification link
        };

        logger.debug('Sending create request', { userData: { ...userData, password: '[REDACTED]', passwordConfirm: '[REDACTED]' } });

        const user = await pb.collection('users').create<User>(userData);

        logger.info('Raw response received', {
            hasId: !!user?.id,
            hasEmail: !!user?.email,
            keys: Object.keys(user || {}),
            fullUser: user
        });

        if (!user || !user.id) {
            logger.error('User creation returned empty/invalid object', { user });
            throw new Error('User creation failed - no user data returned');
        }

        logger.info('User created successfully', { id: user.id, email: user.email });

        return user;
    } catch (error: any) {
        // Parse PocketBase field-specific errors
        const fieldErrors = error?.response?.data || error?.data?.data || {};
        const errorMessages: string[] = [];

        // Extract user-friendly messages from field errors
        for (const [field, fieldError] of Object.entries(fieldErrors)) {
            const err = fieldError as { code: string; message: string };
            if (err?.message) {
                // Create user-friendly error messages
                if (err.code === 'validation_not_unique' && field === 'email') {
                    errorMessages.push('A user with this email already exists');
                } else if (err.code === 'validation_required') {
                    errorMessages.push(`${field.charAt(0).toUpperCase() + field.slice(1)} is required`);
                } else if (err.code === 'validation_invalid_email') {
                    errorMessages.push('Invalid email address');
                } else {
                    errorMessages.push(`${field}: ${err.message}`);
                }
            }
        }

        const userFriendlyMessage = errorMessages.length > 0
            ? errorMessages.join(', ')
            : error.message || 'Failed to create user';

        logger.error('Failed to create user', {
            status: error.status,
            message: userFriendlyMessage,
            fieldErrors,
        });

        // Throw error with user-friendly message
        const enhancedError = new Error(userFriendlyMessage);
        (enhancedError as any).status = error.status;
        (enhancedError as any).fieldErrors = fieldErrors;
        throw enhancedError;
    }
}

// Update a user (admin only)
export async function updateUser(
    id: string,
    data: {
        email?: string;
        name?: string;
        password?: string;
        admin?: boolean;
    }
): Promise<User> {
    try {
        logger.debug('Updating user', { id });

        const updateData: any = {};
        if (data.email !== undefined) updateData.email = data.email;
        if (data.name !== undefined) updateData.name = data.name;
        if (data.admin !== undefined) updateData.admin = data.admin;
        if (data.password) {
            updateData.password = data.password;
        }

        // Use admin endpoint that bypasses oldPassword requirement
        const response = await fetch(`/pb/api/admin/users/${id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': pb.authStore.token,
            },
            body: JSON.stringify(updateData),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw {
                status: response.status,
                message: errorData.error || 'Failed to update user',
                data: errorData.fieldErrors || {},
            };
        }

        const user = await response.json();
        logger.info('User updated', { id });

        return user as User;
    } catch (error: any) {
        // Parse PocketBase field-specific errors
        const fieldErrors = error?.response?.data || error?.data?.data || {};
        const errorMessages: string[] = [];

        for (const [field, fieldError] of Object.entries(fieldErrors)) {
            const err = fieldError as { code: string; message: string };
            if (err?.message) {
                if (err.code === 'validation_not_unique' && field === 'email') {
                    errorMessages.push('A user with this email already exists');
                } else if (err.code === 'validation_required') {
                    errorMessages.push(`${field.charAt(0).toUpperCase() + field.slice(1)} is required`);
                } else if (err.code === 'validation_invalid_email') {
                    errorMessages.push('Invalid email address');
                } else {
                    errorMessages.push(`${field}: ${err.message}`);
                }
            }
        }

        const userFriendlyMessage = errorMessages.length > 0
            ? errorMessages.join(', ')
            : error.message || 'Failed to update user';

        logger.error('Failed to update user', {
            id,
            status: error.status,
            message: userFriendlyMessage,
            fieldErrors,
        });

        const enhancedError = new Error(userFriendlyMessage);
        (enhancedError as any).status = error.status;
        (enhancedError as any).fieldErrors = fieldErrors;
        throw enhancedError;
    }
}

// Delete a user (admin only)
export async function deleteUser(id: string): Promise<boolean> {
    try {
        logger.debug('Deleting user', { id });

        await pb.collection('users').delete(id);
        logger.info('User deleted', { id });

        return true;
    } catch (error: any) {
        logger.error('Failed to delete user', {
            id,
            status: error.status,
            message: error.message,
        });
        throw error;
    }
}

// Get a single user
export async function getUser(id: string): Promise<User> {
    return await pb.collection('users').getOne<User>(id);
}

// Search users by email or name
export async function searchUsers(query: string): Promise<User[]> {
    try {
        const result = await pb.collection('users').getList<User>(1, 50, {
            filter: `email ~ "${query}" || name ~ "${query}"`,
            sort: 'name',
        });

        return result.items;
    } catch (error: any) {
        logger.error('Failed to search users', {
            query,
            message: error.message,
        });
        return [];
    }
}

// Get user avatar URL
export function getUserAvatarUrl(user: User, thumb?: string): string | null {
    if (!user.avatar) return null;
    return pb.files.getURL(user, user.avatar, { thumb });
}

// Request email change for a user (admin only)
export async function requestEmailChange(userId: string, newEmail: string): Promise<{ message: string; newEmail: string }> {
    try {
        logger.debug('Requesting email change', { userId, newEmail });

        const response = await fetch(`/pb/api/admin/users/${userId}/request-email-change`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': pb.authStore.token,
            },
            body: JSON.stringify({ newEmail }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw {
                status: response.status,
                message: errorData.error || 'Failed to request email change',
            };
        }

        const result = await response.json();
        logger.info('Email change requested', { userId, newEmail });

        return result;
    } catch (error: any) {
        const errorMessage = error.message || 'Failed to request email change';

        logger.error('Failed to request email change', {
            userId,
            newEmail,
            status: error.status,
            message: errorMessage,
        });

        const enhancedError = new Error(errorMessage);
        (enhancedError as any).status = error.status;
        throw enhancedError;
    }
}
