import type { Request, Response } from 'express';
import Pipeline from '../model/Pipeline.ts';

export const getPipelines = async (req: Request, res: Response): Promise<void> => {
  try {
    const pipelines = await Pipeline.find().sort({ order: 1 });
    const count = await Pipeline.countDocuments();

    res.status(200).json({
      success: true,
      count,
      data: pipelines
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve pipelines',
      error: error.message
    });
  }
};

export const getPipelineById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (typeof id !== 'string') {
      res.status(400).json({ success: false, message: 'Invalid ID' });
      return;
    }

    const pipeline = await Pipeline.findById(id);

    if (!pipeline) {
      res.status(404).json({
        success: false,
        message: 'Pipeline stage not found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: pipeline
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Error fetching pipeline stage',
      error: error.message
    });
  }
};

export const createPipeline = async (req: Request, res: Response): Promise<void> => {
  try {
    const pipeline = new Pipeline(req.body);
    await pipeline.save();

    res.status(201).json({
      success: true,
      data: pipeline
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: 'Failed to create pipeline stage',
      error: error.message
    });
  }
};

export const deletePipeline = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (typeof id !== 'string') {
      res.status(400).json({ success: false, message: 'Invalid ID' });
      return;
    }

    const pipeline = await Pipeline.findByIdAndDelete(id);

    if (!pipeline) {
      res.status(404).json({ success: false, message: 'Pipeline stage not found' });
      return;
    }

    res.status(200).json({ success: true, message: 'Pipeline stage deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Error deleting pipeline stage', error: error.message });
  }
};

export const updatePipeline = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (typeof id !== 'string') {
      res.status(400).json({ success: false, message: 'Invalid ID' });
      return;
    }

    const updatedPipeline = await Pipeline.findByIdAndUpdate(
      id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!updatedPipeline) {
      res.status(404).json({ success: false, message: 'Pipeline stage not found' });
      return;
    }

    res.status(200).json({
      success: true,
      data: updatedPipeline
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Failed to update pipeline stage',
      error: error.message
    });
  }
};
