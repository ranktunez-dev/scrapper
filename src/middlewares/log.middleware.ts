import { Request, Response, NextFunction } from 'express';

const VALID_TOKEN = 'CFVYSRxIBstS4qaLaAGfnr8VIOoWhM';

export function verifyApi(serviceName: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // 🔐 Token from params
      const token = req.params.token;

      if (!token) {
        return res.status(401).json({
          success: false,
          message: 'Token is required',
          service: serviceName
        });
      }

      if (token !== VALID_TOKEN) {
        return res.status(401).json({
          success: false,
          message: 'Invalid token',
          service: serviceName
        });
      }

      // ✅ Token verified
      next();
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Authorization failed',
        service: serviceName
      });
    }
  };
}
