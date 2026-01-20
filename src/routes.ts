import { Application } from 'express';
import { healthRoutes } from '@scrapper/routes/health.route';
import { scrapRoutes } from '@scrapper/routes/scrap.route';
// import { verifyApi } from './middlewares/log.middleware';


const BASE_PATH = '/api/v1/scrapper';

export function appRoutes(app: Application): void {
    app.use(BASE_PATH,
        //  verifyApi ,
        scrapRoutes());
    app.use('', healthRoutes.routes());
}
