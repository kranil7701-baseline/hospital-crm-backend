import type { Request, Response } from 'express';
import type { AuthRequest } from '../middleware/authMiddleware.ts';
import Task from '../model/Task.ts';
import Notes from '../model/Notes.ts';
import CallLogs from '../model/CallLogs.ts';
import mongoose from "mongoose";



export const getActivities = async (req: Request, res: Response): Promise<void> => {
    try {
        const hospitalId = req.query.hospitalId as string;
        const userId = req.query.userId as string;
        const limit = parseInt(req.query.limit as string) || 20;

        const filter: any = {};
        if (hospitalId) filter.hospital = new mongoose.Types.ObjectId(hospitalId);
        if (userId) filter.user = new mongoose.Types.ObjectId(userId);

        const pipeline: any[] = [
            // 1. Start with Tasks
            { $match: filter },
            { $addFields: { activityType: 'task' } },

            // 2. Union with Notes
            {
                $unionWith: {
                    coll: 'notes',
                    pipeline: [
                        { $match: filter },
                        { $addFields: { activityType: 'note' } }
                    ]
                }
            },

            // 3. Union with CallLogs
            {
                $unionWith: {
                    coll: 'calllogs',
                    pipeline: [
                        { $match: filter },
                        { $addFields: { activityType: 'callLog' } }
                    ]
                }
            },

            // 4. Sort all combined activities by createdAt
            { $sort: { createdAt: -1 } },

            // 5. Global Limit
            { $limit: limit },

            // 6. Final Populates (Lookup)
            {
                $lookup: {
                    from: 'hospitals',
                    localField: 'hospital',
                    foreignField: '_id',
                    pipeline: [{ $project: { hospitalName: 1 } }],
                    as: 'hospital'
                }
            },
            { $unwind: { path: '$hospital', preserveNullAndEmptyArrays: true } },

            {
                $lookup: {
                    from: 'contacts',
                    localField: 'contact',
                    foreignField: '_id',
                    pipeline: [{ $project: { firstName: 1 } }],
                    as: 'contact'
                }
            },
            { $unwind: { path: '$contact', preserveNullAndEmptyArrays: true } }
        ];

        const combinedActivities = await Task.aggregate(pipeline);

        res.status(200).json({
            success: true,
            total: combinedActivities.length,
            data: combinedActivities
        });

    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: "Failed to aggregate activities",
            error: error.message
        });
    }
};

export const deleteActivity = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { id, type } = req.body;

        if (!id || !type) {
            res.status(400).json({ success: false, message: "ID and type are required" });
            return;
        }

        let model;
        switch (type.toLowerCase()) {
            case 'task':
                model = Task;
                break;
            case 'note':
                model = Notes;
                break;
            case 'calllog':
                model = CallLogs;
                break;
            default:
                res.status(400).json({ success: false, message: "Invalid activity type" });
                return;
        }

        // Verify ownership (or existence) before deleting
        const activity = await (model as any).findOneAndDelete({
            _id: new mongoose.Types.ObjectId(id),
            user: (req as any).user?._id
        });

        if (!activity) {
            res.status(404).json({
                success: false,
                message: "Activity not found or you don't have permission to delete it"
            });
            return;
        }

        res.status(200).json({ success: true, message: `${type} deleted successfully` });

    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: "Failed to delete activity",
            error: error.message
        });
    }
};

export const createActivity = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { type, data } = req.body;

        if (!type || !data) {
            res.status(400).json({ success: false, message: "Type and data are required" });
            return;
        }

        let model;
        let populateOptions: any = [{ path: 'hospital', select: 'hospitalName' }];

        switch (type.toLowerCase()) {
            case 'task':
                model = Task;
                break;
            case 'note':
                model = Notes;
                break;
            case 'calllog':
                model = CallLogs;
                populateOptions.push({ path: 'contact', select: 'firstName' });
                break;
            default:
                res.status(400).json({ success: false, message: "Invalid activity type" });
                return;
        }

        // Add user ID to the data
        const activityData = {
            ...data,
            user: (req as any).user?._id
        };

        const newActivity = new (model as any)(activityData);
        await newActivity.save();
        await newActivity.populate(populateOptions);

        res.status(201).json({
            success: true,
            message: `${type} created successfully`,
            data: newActivity
        });

    } catch (error: any) {
        res.status(400).json({
            success: false,
            message: `Failed to create ${req.body.type || 'activity'}`,
            error: error.message
        });
    }
};