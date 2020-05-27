import * as moment from 'moment';
import * as __ from 'lodash/fp';
import * as _ from 'lodash';

import { Session } from './session';
import { JiraTempoApi } from './jira-api';
import { durationFormat, loadDotEnvConfig, readCsv, rootDir, Row } from './helpers';

// tempoApi.add(
//   'XXX-1234',
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

const delay = (ms: number) => new Promise((resolve) => setTimeout(() => resolve(), ms));

const session = new Session(rootDir('.session.json'));

const config = loadDotEnvConfig();
const jiraApi = new JiraTempoApi(config, session);

init();

async function init() {
  await jiraApi.auth();

  const reportFile = rootDir('data.csv');
  readCsv(reportFile)
    .then((rows: Row[]) =>
      __.flow(
        // @todo: remove any and specify an interface
        __.map((row: any) => {
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
        }),
        __.filter(row => !config.excludeProjects.has(row.project.toLowerCase())),
        __.partition(row => row.isValid),
      )(rows),
    )
    .then(([ validRows, invalidRows ]) => {
      if (_.some(invalidRows)) {
        console.error('Invalid rows:\n' + _.map(invalidRows, v => JSON.stringify(v)).join('\n'));
      }
      return validRows;
    })
    .then(async (rows) => {
      const maxTaskLength = rows.map(r => r.task).reduce((max, curr) => Math.max(max, curr.length), 0);
      const maxTimeLength = rows.map(r => durationFormat(r.duration))
        .reduce((max, curr) => Math.max(max, curr.length), 0);

        const saveRow = (row) => {
            const baseInfo = [
                row.date.format('DD-MMM-YYYY'),
                row.task.padEnd(maxTaskLength),
                durationFormat(row.duration).padEnd(maxTimeLength),
            ];

            return jiraApi.getLoggedTime(row.task)
                          .then(async (loggedDuration) => {
                              const logged = loggedDuration.asHours();
                              const toLog = row.duration.asHours();

                              // @todo: implement configurable validation
                              // if (logged + toLog > 16) {
                              //   throw new Error('More 16 hours.'
                              //     + ` ${logged} (logged) + ${toLog} (new) = ${logged + toLog}`);
                              // }

                              const res = await jiraApi.add(
                                  row.task,
                                  row.date,
                                  row.duration,
                                  row.description,
                              );
                              // await delay(500);
                              return res;
                          })
                          .then(
                              (res) => {
                                  console.log(
                                      [ res.statusCode,
                                          ...baseInfo,
                                          row.description.slice(0, 50) + (row.description.length > 50 ? ' ...' : ''),
                                      ].join(' | ')
                                  );
                              }, (err) => {
                                  if (err.statusCode !== undefined) {
                                      const description = String(err.response.body)
                                          .replace(/\s{2,}/g, ' ');

                                      console.log(
                                          [ err.statusCode,
                                              ...baseInfo,
                                              description.slice(0, 50) + (description.length > 50 ? ' ...' : ''),
                                          ].join(' | ')
                                      );
                                  } else {
                                      console.log(
                                          [ 'XXX',
                                              ...baseInfo,
                                              err.message.slice(0, 50) + (err.message.length > 50 ? ' ...' : ''),
                                          ].join(' | ')
                                      );
                                  }
                              }
                          );
        }

        for (const row of rows) await saveRow(row);
      // _
      //   .chain(rows)
      //   .groupBy('task')
      //   .values()
      //   .forEach((groupedRows) => {
      //     groupedRows.reduce(
      //       (p, row) => p.then(),
      //       Promise.resolve(),
      //     );
      //
      //   })
      //   .value();

    })
  ;
} // init()

