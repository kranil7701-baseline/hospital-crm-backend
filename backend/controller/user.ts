import type { Request, Response } from 'express';
import User from '../model/User.ts';
import { validatePassword, validateEmail } from '../helper/user.ts';
import type { AuthRequest } from '../middleware/authMiddleware.ts';


export const getUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Query params
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || "";

    const skip = (page - 1) * limit;

    const searchQuery = search
      ? {
        $or: [
          { name: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } }
        ]
      }
      : {};

    // Fetch users
    const users = await User.find(searchQuery)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await User.countDocuments(searchQuery);

    res.status(200).json({
      success: true,
      page,
      limit,
      totalUsers: total,
      totalPages: Math.ceil(total / limit),
      data: users
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to retrieve users",
      error: error.message
    });
  }
};



export const getUsersAdmin = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Query params
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || "";

    const skip = (page - 1) * limit;

    const searchQuery: any = search
      ? {
        $or: [
          { name: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } }
        ]
      }
      : {};

    // Exclude the current user
    if (req.user) {
      searchQuery._id = { $ne: req.user._id };
    }

    // Fetch users
    const users = await User.find(searchQuery)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await User.countDocuments(searchQuery);

    res.status(200).json({
      success: true,
      page,
      limit,
      totalUsers: total,
      totalPages: Math.ceil(total / limit),
      data: users
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to retrieve users",
      error: error.message
    });
  }
};



export const getUserById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);

    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Error fetching user',
      error: error.message
    });
  }
};

export const createUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    const emailError = validateEmail(email);
    if (emailError) {
      res.status(400).json({ success: false, message: emailError });
      return;
    }

    const userExists = await User.findOne({ email });
    if (userExists) {
      res.status(400).json({ success: false, message: 'User already exists' });
      return;
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      res.status(400).json({ success: false, message: passwordError });
      return;
    }


    const user = new User(req.body);
    await user.save();

    res.status(201).json({
      success: true,
      data: user
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: 'Failed to create user',
      error: error.message
    });
  }
};

export const updateUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { email, password } = req.body;

    // Validate Email if provided
    if (email) {
      const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
      if (!emailRegex.test(email)) {
        res.status(400).json({ success: false, message: 'Please enter a valid email' });
        return;
      }
    }

    // Validate Password if provided
    if (password) {
      if (password.length < 8) {
        res.status(400).json({ success: false, message: 'Password must be at least 8 characters long' });
        return;
      }
      if (!/[a-z]/.test(password)) {
        res.status(400).json({ success: false, message: 'Password must include at least one lowercase letter' });
        return;
      }
      if (!/[A-Z]/.test(password)) {
        res.status(400).json({ success: false, message: 'Password must include at least one uppercase letter' });
        return;
      }
      if (!/\d/.test(password)) {
        res.status(400).json({ success: false, message: 'Password must include at least one number' });
        return;
      }
      if (!/[@$!%*?&#]/.test(password)) {
        res.status(400).json({ success: false, message: 'Password must include at least one special character (@$!%*?&#)' });
        return;
      }
    }

    const user = await User.findById(id).select('+password');

    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
      return;
    }

    // Explicitly update fields from req.body
    Object.keys(req.body).forEach(key => {
      (user as any)[key] = req.body[key];
    });

    await user.save(); // This runs validators AND pre-save hooks (for password)

    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: 'Failed to update user',
      error: error.message
    });
  }
};

export const deleteUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const user = await User.findByIdAndDelete(id);

    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: 'Failed to delete user',
      error: error.message
    });
  }
};

export const updateUserStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.query.id as string;
    const active = req.query.active === 'true';

    if (!id) {
      res.status(400).json({
        success: false,
        message: 'User ID is required in query'
      });
      return;
    }

    const user = await User.findByIdAndUpdate(
      id,
      { active },
      { new: true, runValidators: true }
    );

    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: `User ${active ? 'activated' : 'deactivated'} successfully`,
      data: user
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: 'Failed to update user status',
      error: error.message
    });
  }
};