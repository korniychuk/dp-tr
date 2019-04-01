const request = require('request-promise-native');
const moment  = require('moment');
const path    = require('path');
const csv     = require('csv-parser');
const fs      = require('fs');
const _       = require('lodash');

/*
 * http status 415 from Jira means - incorrect Content-Type header
 */

const rootDir = (...parts) => path.join(__dirname, ...parts);

function durationFormat(duration) {
  return `${duration.hours()}h ${duration.minutes()}m`;
}

function readCsv(filename) {
  return new Promise(function(resolve, reject){
    function onError(err){
      reject(err);
    }

    function onReadable(){
      cleanup();
      resolve(stream);
    }

    function cleanup(){
      stream.removeListener('readable', onReadable);
      stream.removeListener('error', onError);
    }

    const results = [];
    const stream = fs.createReadStream(filename, { encoding: 'UTF-8' })
      .pipe(
        csv({
          headers: ['date', 'project', 'task', 'type', 'description', 'duration'],
          separator: '\t',
        }),
      );
    stream.on('error', onError);
    stream.on('data', (data) => results.push(data));
    stream.on('end', function(){
      resolve(results);
    });
  });
}

function loadDotEnvConfig() {
  require('dotenv').config();

  const config = {
    jiraHost: process.env.JIRA_HOST,
    jiraCookies: process.env.JIRA_COOKIES,
    jiraUserName: process.env.JIRA_USER_NAME,
  };
  const excludeProjects = process.env.EXCLUDE_PROJECTS;

  if (_.isEmpty(config.jiraHost) || /^https?:\/\/.+/.test(config.jiraHost)) {
    throw new Error(`Config: Invalid JIRA_HOST`);
  }
  if (_.isEmpty(config.jiraCookies) || !/DWRSESSIONID/.test(config.jiraCookies)) {
    throw new Error(`Config: Invalid JIRA_COOKIES`);
  }
  if (_.isEmpty(config.jiraUserName)) {
    throw new Error(`Config: Invalid JIRA_USER_NAME`);
  }

  config.excludeProjects = new Set(_.isEmpty(excludeProjects) ? [] : excludeProjects.split(','));

  return config;
}

class JiraTempoApi {

  constructor({ jiraHost, jiraUserName, jiraCookies }, req) {
    this._jiraUrl = `https://${jiraHost}`;
    this._restUrl = this._jiraUrl + '/rest';
    this._tempoUrl = this._restUrl + '/tempo-rest/1.0';
    this._worklogsUrl = this._tempoUrl + '/worklogs';

    this._username = jiraUserName;

    this._req = req.defaults({
      gzip: true,
      resolveWithFullResponse: true,
      headers: {
        'Host': jiraHost,
        'Origin': this._jiraUrl,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/72.0.3626.109 Safari/537.36',
        'Accept-Language': 'ru,ru-RU;q=0.9,en-US;q=0.8,en;q=0.7',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': '*/*',
        'Cookie': jiraCookies,
      },
    });
  }

  /**
   * @param task         @example 'XOO-1234'
   * @param date         moment instance
   * @param duration     moment duration instance
   * @param description  @example 'Some text'
   */
  async add(task, date, duration, description) {
    const url = this._worklogsUrl + `/${task}`;
    const d = date.clone().hours(15).minutes(10).seconds(15);

    const headers = {
      'Referer': `${this._jiraUrl}/browse/${task}`,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    };

    /** format: 3h 45m */
    const remaining = await this.getRemainingEstimate(task, date, duration)
                                .then(res => res.body);

    const form = {
      id:                         /*                      */ '' ,
      type:                       /*                      */ 'issue' ,
      'use-ISO8061-week-numbers': /*                      */ 'false' ,
      ansidate:                   /* * '2019-03-29T13:34' */ d.format('YYYY-MM-DDTHH:mm'),
      ansienddate:                /*   '2019-03-29'       */ d.format('YYYY-MM-DD'),
      'selected-panel':           /*                      */ '',
      'analytics-origin-page':    /*                      */ 'Issue Search or Issue View',
      'analytics-origin-view':    /*                      */ 'Tempo Issue Panel',
      'analytics-origin-action':  /*                      */ 'Clicked Log Work Button',
      'analytics-page-category':  /*                      */ 'JIRA',
      startTimeEnabled:           /*                      */ 'true',
      actionType:                 /* *                    */ 'logTime',
      tracker:                    /* *                    */ 'false',
      preSelectedIssue:           /*    'XOO-1234'        */ task,
      planning:                   /*                      */ 'false',
      selectedUser:               /* *                    */ this._username,
      issue:                      /*    'XOO-1234'        */ task,
      date:                       /*    'Mar 29, 2019'    */ d.format('MMM DD, YYYY'),
      enddate:                    /*    'Mar 29, 2019'    */ d.format('MMM DD, YYYY'),
      worklogtime:                /*    '1:34 pm'         */ d.format('LT').toLowerCase(),
      time:                       /* *  '1.25'            */ durationFormat(duration),
      remainingEstimate:          /* *  '2h'              */ remaining,
      comment:                    /* *                    */ description,
    };

    return this._req.post({ url, headers, form });
  }

  /**
   * @param task     @example 'XOO-1234'
   * @param date     moment instance
   * @param duration moment duration instance
   * @return string  time in format `{H}h {MM}m`
   */
  getRemainingEstimate(task, date, duration) {
    const date1 = date.format('YYYY-MM-DD');
    const date2 = date.format('YYYY-MM-DD');
    const durationStr = encodeURIComponent(durationFormat(duration));

    const url = this._worklogsUrl + `/remainingEstimate/calculate/${task}/${date1}/${date2}/${durationStr}`;
    const qs = { _: +new Date() };

    const headers = {
      'Referer': `${this._jiraUrl}/browse/${task}`
    };

    return this._req.get({ url, qs, headers });
  }

  // // date or time
  // update() {
  //
  // }

  // delete() {
  //
  // }


}
//
// tempoApi.add(
//   'XOO-1234',
//   moment(),
//   moment.duration(1.25, 'hours'),
//   'dev time'
// ).then(
//   (r) => {
//     console.log('OK', r.statusCode);
//   },
//   (err) => {
//     console.log('ERR', err.statusCode, err.message, err.response.headers, err.response.body);
//   }
// );

const config = loadDotEnvConfig();
const tempoApi = new JiraTempoApi(config, request);

const reportFile = rootDir('data.csv');
readCsv(reportFile)
  .then((rows) =>
    _.chain(rows)
      .map(row => {
        row.date = moment(row.date, 'DD-MMM-YYYY');
        row.isDateValid = row.date.isValid();

        const duration = +row.duration;
        row.isDurationValid = Number.isFinite(duration)
                                           && duration >= .25
                                           && duration % 0.25 === 0;
        row.duration = row.isDurationValid ? moment.duration(duration, 'hours') : 0;

        row.isValid = row.isDateValid
                   && row.isDurationValid
        ;

        return row;
      })
      .filter(row => !config.excludeProjects.has(row.project))
      .partition(row => row.isValid)
      .value(),
  )
  .then(([ validRows, invalidRows ]) => {
    if (_.some(invalidRows)) {
      console.error('Invalid rows:', invalidRows.join(' | '));
    }
    return validRows;
  })
  .then((rows) => {
    const maxTaskLength = rows.map(r => r.task).reduce((max, curr) => Math.max(max, curr.length), 0);
    const maxTimeLength = rows.map(r => durationFormat(r.duration))
                              .reduce((max, curr) => Math.max(max, curr.length), 0);
    rows.forEach(row => {
      const baseInfo = [
        row.date.format('DD-MMM-YYYY'),
        row.task.padEnd(maxTaskLength),
        durationFormat(row.duration).padEnd(maxTimeLength),
      ];
      tempoApi.add(
        row.task,
        row.date,
        row.duration,
        row.description,
      ).then(
        (res) => {
          console.log(
            [ res.statusCode,
              ...baseInfo,
              row.description.slice(0, 50) + (row.description.length > 50 ? ' ...' : ''),
            ].join(' | ')
          );
        }, (err) => {
          console.log(
            [ err.statusCode,
              ...baseInfo,
              err.response.body,
            ].join(' | ')
          );
        }
      );
    })
  })
;
