import dotenv from 'dotenv';

dotenv.config({});

if (process.env.ENABLE_APM === '1') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('elastic-apm-node').start({
    serviceName: 'seo-scapper',
    serverUrl: process.env.ELASTIC_APM_SERVER_URL,
    secretToken: process.env.ELASTIC_APM_SECRET_TOKEN,
    environment: process.env.NODE_ENV,
    active: true,
    captureBody: 'all',
    errorOnAbortedRequests: true,
    captureErrorLogStackTraces: 'always'
  });
}

class Config {
  public ENABLE_APM: string | undefined;
  public Scrapper_JWT_TOKEN: string | undefined;
  public JWT_TOKEN: string | undefined;
  public INVITATION_JWT_TOKEN: string | undefined;
  
  public NODE_ENV: string | undefined;
  public SECRET_KEY_ONE: string | undefined;
  public SECRET_KEY_TWO: string | undefined;
  public CLIENT_URL: string | undefined;
  public Scrapper_BASE_URL: string | undefined;
  public NOTIFICATION_BASE_URL: string | undefined;
  public AUTH_BASE_URL: string | undefined;
  public SITE_PROJECT_BASE_URL: string | undefined;
  public SYNC_UP_BASE_URL: string | undefined;
  public TEAMS_MANAGEMENT_BASE_URL: string | undefined;
  public LOG_BASE_URL: string | undefined;
  public REDIS_HOST: string | undefined;
  public ELASTIC_SEARCH_URL: string | undefined;
  public ELASTIC_APM_SERVER_URL: string | undefined;
  public ELASTIC_APM_SECRET_TOKEN: string | undefined;
  public COOKIES_DOMAIN: string | undefined;
  public RABBITMQ_ENDPOINT: string | undefined;
  public ACCESS_MANAGEMENT_BASE_URL:string|undefined;

  constructor() {
    this.ENABLE_APM = process.env.ENABLE_APM || '';
    this.SITE_PROJECT_BASE_URL = process.env.SITE_PROJECT_BASE_URL || '';
    
    this.Scrapper_JWT_TOKEN = process.env.Scrapper_JWT_TOKEN || '12312321';
    this.JWT_TOKEN = process.env.JWT_TOKEN || '';
    this.INVITATION_JWT_TOKEN = process.env.INVITATION_JWT_TOKEN || '';
    this.NODE_ENV = process.env.NODE_ENV || '';
    this.SECRET_KEY_ONE = process.env.SECRET_KEY_ONE || '';
    this.SECRET_KEY_TWO = process.env.SECRET_KEY_TWO || '';
    this.CLIENT_URL = process.env.CLIENT_URL || '';
    this.Scrapper_BASE_URL = process.env.Scrapper_BASE_URL || '';
    this.NOTIFICATION_BASE_URL = process.env.NOTIFICATION_BASE_URL || '';
    this.AUTH_BASE_URL = process.env.AUTH_BASE_URL || '';

    this.SYNC_UP_BASE_URL = process.env.SYNC_UP_BASE_URL || '';
    this.TEAMS_MANAGEMENT_BASE_URL = process.env.TEAMS_MANAGEMENT_BASE_URL || '';
    this.LOG_BASE_URL = process.env.LOG_BASE_URL || '';
    this.REDIS_HOST = process.env.REDIS_HOST || '';
    this.ELASTIC_SEARCH_URL = process.env.ELASTIC_SEARCH_URL || '';
    this.ELASTIC_APM_SERVER_URL = process.env.ELASTIC_APM_SERVER_URL || '';
    this.ELASTIC_APM_SECRET_TOKEN = process.env.ELASTIC_APM_SECRET_TOKEN || '';
    this.COOKIES_DOMAIN = process.env.COOKIES_DOMAIN || '';
    this.RABBITMQ_ENDPOINT = process.env.RABBITMQ_ENDPOINT || '';
    this.ACCESS_MANAGEMENT_BASE_URL=process.env.ACCESS_MANAGEMENT_BASE_URL||'';
  }
}

export const config: Config = new Config();
