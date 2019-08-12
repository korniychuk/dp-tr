import * as csv from 'csv-parser';
import * as fs from 'fs';
import * as moment from 'moment';
import * as _ from 'lodash';
import { Config } from './config';

export function durationFormat(duration) {
  return `${ duration.hours() }h ${ duration.minutes() }m`;
}

/**
 * @param {string} strDuration
 * @return moment duration instance
 */
export function durationParse(strDuration) {
  const hours   = /(\d+)h/.test(strDuration) ? +/(\d+)h/.exec(strDuration)[1] : 0;
  const minutes = /(\d+)m/.test(strDuration) ? +/(\d+)m/.exec(strDuration)[1] : 0;

  return moment.duration({ hours, minutes });
}

export function readCsv(filename) {
  return new Promise(function (resolve, reject) {
    function onError(err) {
      reject(err);
    }

    function onReadable() {
      cleanup();
      resolve(stream);
    }

    function cleanup() {
      stream.removeListener('readable', onReadable);
      stream.removeListener('error', onError);
    }

    const results = [];
    const stream  = fs.createReadStream(filename, { encoding: 'UTF-8' })
      .pipe(
        csv({
          headers:   ['date', 'project', 'task', 'type', 'description', 'duration'],
          separator: '\t',
        }),
      );
    stream.on('error', onError);
    stream.on('data', (data) => results.push(data));
    stream.on('end', function () {
      resolve(results);
    });
  });
}

export function loadDotEnvConfig(): Config {
  require('dotenv').config();

  const excludeProjectsStr = process.env.EXCLUDE_PROJECTS;
  const excludeProjects = new Set(_.isEmpty(excludeProjectsStr)
                                  ? []
                                  : excludeProjectsStr.toLowerCase().split(','));

  const config: Config = {
    excludeProjects,
    jiraHost:          process.env.JIRA_HOST,
    jiraCookies:       process.env.JIRA_COOKIES,
    jiraUserName:      process.env.JIRA_USER_NAME,
    jiraUserNameHuman: process.env.JIRA_USER_NAME_HUMAN,
  };

  if (_.isEmpty(config.jiraHost) || /^https?:\/\/.+/.test(config.jiraHost)) {
    throw new Error(`Config: Invalid JIRA_HOST`);
  }
  if (_.isEmpty(config.jiraCookies)) {
    throw new Error(`Config: Invalid JIRA_COOKIES`);
  }
  if (_.isEmpty(config.jiraUserName)) {
    throw new Error(`Config: Invalid JIRA_USER_NAME`);
  }
  if (_.isEmpty(config.jiraUserNameHuman)) {
    throw new Error(`Config: Invalid JIRA_USER_NAME_HUMAN`);
  }

  config.jiraUserNameHuman = config.jiraUserNameHuman.toLowerCase();

  return config;
}
