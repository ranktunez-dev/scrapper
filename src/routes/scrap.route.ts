import { gmbRankingByCoordinates } from '@scrapper/controllers/gmb.location';
// import { consoleDataFetch } from '@onboarding/services/console.data.service';
import express, { Router } from 'express';
// import { backlinkImport } from '@onboarding/controllers/backlinkManage.controller';

const router: Router = express.Router();

export function scrapRoutes(): Router {

    router.post('/get/gmb/ranking', gmbRankingByCoordinates)
    return router;
}