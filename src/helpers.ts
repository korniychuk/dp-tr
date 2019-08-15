import * as csv from 'csv-parser';
import * as fs from 'fs';
import * as moment from 'moment';
import * as _ from 'lodash';
import * as path from 'path';

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

export const rootDir = (...parts) => path.join(__dirname, '..', ...parts);

export interface Row {
  date: string;
  project: string;
  task: string;
  type: string;
  description: string;
  duration: string;
}

export function readCsv(filename): Promise<Row[]> {
  return new Promise(function (resolve, reject) {
    function onError(err) {
      reject(err);
    }

    function onReadable() {
      cleanup();
      resolve(stream as any);
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
    jiraHost:          _.trim(process.env.JIRA_HOST),
    jiraUserName:      _.trim(process.env.JIRA_USER_NAME),
    jiraUserNameHuman: _.trim(process.env.JIRA_USER_NAME_HUMAN),
    jiraLogin:         _.trim(process.env.JIRA_LOGIN),
    jiraPassword:      _.trim(process.env.JIRA_PASSWORD),
  };

  if (_.isEmpty(config.jiraHost) || /^https?:\/\/.+/.test(config.jiraHost)) {
    throw new Error(`Config: Invalid JIRA_HOST`);
  }
  if (_.isEmpty(config.jiraLogin)) {
    throw new Error(`Config: Invalid JIRA_LOGIN`);
  }
  if (_.isEmpty(config.jiraPassword)) {
    throw new Error(`Config: Invalid JIRA_PASSWORD`);
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
