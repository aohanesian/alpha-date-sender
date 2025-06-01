import { Request, Response, NextFunction } from 'express';

export const validateLogin = (req: Request, res: Response, next: NextFunction) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  
  next();
};

export const validateRegister = (req: Request, res: Response, next: NextFunction) => {
  const { email, password, confirmPassword } = req.body;
  
  if (!email || !password || !confirmPassword) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  
  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match' });
  }
  
  next();
}; 