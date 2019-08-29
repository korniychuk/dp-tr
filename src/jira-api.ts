import * as jsdom from 'jsdom';
import * as moment  from 'moment';
import { Response } from 'request';
import { RequestPromiseAPI } from 'request-promise-native';
import * as request from 'request-promise-native';

import { durationFormat, durationParse } from './helpers';
import { Config } from './config';
import { Session } from './session';

const { JSDOM } = jsdom;

/*
 * http status 415 from Jira means - incorrect Content-Type header
 */
export class JiraTempoApi {
  private readonly jiraUrl: string;
  private readonly restUrl: string;
  private readonly tempoUrl: string;
  private worklogsUrl: string;
  private req: RequestPromiseAPI;

  public constructor(
    private config: Config,
    private session: Session,
  ) {
    this.jiraUrl     = `https://${ config.jiraHost }`;
    this.restUrl     = this.jiraUrl + '/rest';
    this.tempoUrl    = this.restUrl + '/tempo-rest/1.0';
    this.worklogsUrl = this.tempoUrl + '/worklogs';

    this.setupRequest();
  }

  /**
   * Loads Jira session
   * @returns is session successfully opened or not
   */
  public async auth(): Promise<void> {
    this.session.load();

    if (this.session.data.cookies && await this.isCookiesValid(this.session.data.cookies)) {
      this.setupRequest(this.session.data.cookies);
      console.log('Using already opened Jira session');
      return;
    }

    console.log('Authenticating to Jira...');
    const cookies = await this.login(this.config.jiraLogin, this.config.jiraPassword);
    const isOk = await this.isCookiesValid(cookies);
    if (!isOk) {
      throw new Error(`Auth() Logged in successful, but test cookies request failed.`);
    }

    console.log('New Cookies:', cookies);
    this.session.data.cookies = cookies;
    this.session.save();
    console.log('Session saved.');
    this.setupRequest(this.session.data.cookies);
    console.log('Session opened.');

  }

  /**
   * Do login and returns cookies.
   * Notice: takes login and password from the config.
   * @param login    jira login
   * @param password jira password
   */
  public login(login: string, password: string): Promise<string> {
    const url = `${this.restUrl}/gadget/1.0/login`;
    const form = {
      os_username: login,
      os_password: password,
      os_cookie: true,
    };

    return this.req.post({ url, form }).then((res: Response) => {
      const body = JSON.parse(res.body);
      if (body.captchaFailure) {
        throw new Error(`Login() Captcha requested. You need to logout and login via the browser`);
      } else if (body.loginSucceeded) {
        const cookies: string[] = res.caseless.get('Set-Cookie');
        return cookies.join('; ');
      }
      throw new Error(`Login() Wrong login and/or password.\nStatus: ${res.statusCode}.\nBody: ${res.body}`);
      // throw new Error(`Login() Can not login by unknown reason. Wrong response. Status: ${e.statusCode}`);
    });
  }

  /**
   * @param task         @example 'XXX-1234'
   * @param date         moment instance
   * @param duration     moment duration instance
   * @param description  @example 'Some text'
   */
  public async add(
    task: string,
    date: moment.Moment,
    duration: moment.Duration,
    description?: string,
  ) {
    const url = this.restUrl + `/tempo-timesheets/4/worklogs/`;
    const d   = date.clone().hours(15).minutes(10).seconds(15);

    const headers = {
      'Referer':      `${ this.jiraUrl }/browse/${ task }`,
    };

    const id: number = await this.getIssueIdByTaks(task);

    /** format: number of seconds */
    const remaining = await this.getRemainingEstimate(id, task, duration);

    const json = {
      attributes:                                                      {},
      billableSeconds:                                                 '',
      comment:                                                         description || null,
      endDate:                                                         null,
      includeNonWorkingDays:                                           false,
      originTaskId:                  /* * '320411'                  */ String(id),
      remainingEstimate:             /* * 1800                      */ remaining,
      started:                       /* * '2019-08-29T16:02:52.233' */ d.toISOString(),
      timeSpentSeconds:              /* * 1800                      */ duration.asSeconds(),
      worker:                        /* * 'firstname.lastname'      */ this.config.jiraUserName,
    };

    return this.req.post({ url, headers, json });
  }

  /**
   * @return Promise<boolean>
   */
  public async isCookiesValid(cookies?: string): Promise<boolean> {
    const url = `${ this.restUrl }/tempo-timesheets/3/private/config`;

    const headers = cookies ? { 'Cookie': cookies } : {};
    return this.req.get({ url, headers }).then(() => true, () => false);
  }

  /**
   * @return number of seconds
   */
  public getRemainingEstimate(id: number, task: string, duration: moment.Duration): Promise<number> {
    const url = this.restUrl + '/api/2/search/';
    const qs  = { _: +new Date() };

    const headers = {
      'Referer': `${ this.jiraUrl }/browse/${ task }`,
    };

    const json = {
      jql: `issue in (${id})`,
      fields: [
        'timeestimate',
      ],
      startAt: 0,
      maxResults: 200,
    };

    return this.req.post({ url, qs, headers, json }).then(res => {
      const body = res.body;

      const beforeThisTracking = body.issues
                              && body.issues[0]
                              && body.issues[0].fields
                              && body.issues[0].fields.timeestimate;

      const after = beforeThisTracking - duration.asSeconds();
      return after >= 0 ? after : 0;
    });
  }

  /**
   * @todo: this is the same request to {@link getLoggedTime}. Merge it.
   * @param task @example 'XXX-1234'
   * @returns id of the task
   */
  public getIssueIdByTaks(task: string): Promise<number> {
    const url = `${ this.jiraUrl }/browse/${ task }`;

    const headers = {
      'Referer': `${ this.jiraUrl }/browse/${ task }`
    };

    return this.req.get({ url, headers })
       .then(res => res.body)
       .then(page => new JSDOM(page, { runScripts: 'outside-only' }))
       .then(jsDom => {
         const id: number | undefined = [...jsDom.window.document.querySelectorAll('[data-issue-id]')]
           .map(el$ => +el$.getAttribute('data-issue-id'))
           .find(Boolean);

         if (!id) {
           throw new Error(`Can not find ID by Task: ${task}`);
         }

         return id;
       });

  }

  /**
   * @param task @example 'XXX-1234'
   *
   * @return Promise moment duration instance
   */
  public getLoggedTime(task) {
    const url = `${ this.jiraUrl }/browse/${ task }`;

    const headers = {
      'Referer': `${ this.jiraUrl }/browse/${ task }`
    };

    return this.req.get({ url, headers })
      .then(res => res.body)
      .then(page => new JSDOM(page, { runScripts: 'outside-only' }))
      .then(jsDom => {
        const dlElements = [...jsDom.window.document.querySelectorAll('.tempo.tt_inner dl')];
        const myElement  = dlElements.find(el =>
          el.innerHTML.toLowerCase().indexOf(this.config.jiraUserNameHuman) > -1);
        if (myElement) {
          const durationEl = myElement.querySelector('dd > span:first-child');
          if (durationEl) {
            const strDuration = durationEl.innerHTML;
            if (strDuration) {
              return durationParse(strDuration);
            }
          }
        }
        return moment.duration();
      })
      ;
  }

  // // date or time
  // update() {
  //
  // }

  // delete() {
  //
  // }


  private setupRequest(cookies?: string): void {
    const headers = {
      'Host':             this.config.jiraHost,
      'Origin':           this.jiraUrl,
      'User-Agent':       'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/72.0.3626.109 Safari/537.36',
      'Accept-Language':  'ru,ru-RU;q=0.9,en-US;q=0.8,en;q=0.7',
      'X-Requested-With': 'XMLHttpRequest',
      'Accept':           '*/*',
    };
    if (cookies) {
      headers['Cookie'] = cookies;
    }

      this.req = request.defaults({
      gzip: true,
      resolveWithFullResponse: true,
      headers,
    });

  }

}
