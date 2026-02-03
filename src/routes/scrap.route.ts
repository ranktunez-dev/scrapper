import { gmbRankingByCoordinates } from '@scrapper/controllers/gmb.location';
import { main } from '@scrapper/controllers/siteAudit.controller';
import { getWebsiteRanking } from '@scrapper/controllers/website.ranking';;
import express, { Router } from 'express';

const router: Router = express.Router();

export function scrapRoutes(): Router {

    router.post('/get/gmb/ranking', gmbRankingByCoordinates)
    router.post('/get/website/ranking', getWebsiteRanking)

    router.post('/get/site/audit', main)
    return router;
}