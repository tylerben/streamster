import axios from 'axios';
import Ajv from 'ajv';
import {
  queryParameters,
  usgsConfig,
  usgsInstantaneousService,
} from '../types';
import prepareUrl from '../lib/prepareUrl';
import { transform } from '@streamster/coyote';

const ajv = new Ajv();

/**
 * Define the schema for the USGS Daily Values service
 * The output format is a little brutal and requires quite a bit
 * of restructuring.
 * A sample response can be found at
 * https://waterservices.usgs.gov/nwis/dv/?format=json&sites=01646500&siteStatus=all
 */
const instantaneousSchema = {
  date: 'value.timeSeries.*.values[0].value.*.dateTime',
  siteId: 'value.timeSeries.*.sourceInfo.siteCode[0].value',
  siteName: 'value.timeSeries.*.sourceInfo.siteName',
  parameterId: 'value.timeSeries.*.variable.variableCode[0].value',
  parameter: 'value.timeSeries.*.variable.variableName',
  units: 'value.timeSeries.*.variable.unit.unitCode',
  value: 'value.timeSeries.*.values[0].value.*.value',
  qualifiers: 'value.timeSeries.*.values[0].value.*.qualifiers',
  latitude: 'value.timeSeries.*.sourceInfo.geoLocation.geogLocation.latitude',
  longitude: 'value.timeSeries.*.sourceInfo.geoLocation.geogLocation.longitude',
};

/**
 * Define our schema for the query parameters that can be passed
 * to the Daily service.
 * This schema used as part of the schema validation step
 */
const queryParamsSchema = {
  type: 'object',
  properties: {
    site: { type: 'string' },
    sites: { type: 'string' },
    stateCd: { type: 'string' },
    huc: { type: 'string' },
    bBox: { type: 'string' },
    countyCd: { type: 'string' },
    startDT: { type: 'string' },
    endDT: { type: 'string' },
    period: { type: 'string' },
    siteStatus: { type: 'string' },
    parameterCd: { type: 'string' },
  },
  oneOf: [
    { required: ['site'] },
    { required: ['sites'] },
    { required: ['stateCd'] },
    { required: ['huc'] },
    { required: ['bBox'] },
    { required: ['countyCd'] },
  ],
  additionalProperties: false,
};

class Instantaneous implements usgsInstantaneousService {
  /**
   * Validation utility that compares the provided arguments
   * against the defined schema
   * AJV makes this super easy
   * @param config provided arguments to the Daily service that
   * need to be validated
   * @returns {boolean | array} returns true if no errors and an array
   * of errors if errors encountered
   */
  public validate(config: queryParameters) {
    const valid = ajv.compile(queryParamsSchema);
    if (valid(config)) {
      return true;
    } else {
      return valid.errors;
    }
  }

  /**
   * Fetch the data from the USGS Service based on the configuration options
   * provided by the user
   * @param options
   */
  public async getInstantaneousData(config: usgsConfig) {
    this.validate(config.queryParameters);
    const url = prepareUrl('instantaneous', config.queryParameters);

    try {
      const data = await axios.get(url).then((result: any) => {
        if (config.format === 'raw') {
          return result.data;
        } else if (config.format === 'time-series-geojson') {
          const timeSeries = [
            ...transform({
              data: result.data,
              schema: instantaneousSchema,
            }),
          ];
          if (!timeSeries) return [];
          const fields = Object.keys(timeSeries[0]);
          const geojson = {
            type: 'FeatureCollection',
            // todo type me
            features: timeSeries.map((rec: any) => {
              return {
                type: 'Feature',
                geometry: {
                  type: 'Point',
                  coordinates: [rec.longitude, rec.latitude],
                },
                properties: fields.reduce(
                  (acc: { [key: string]: any }, curr: string) => {
                    acc[curr] = rec[curr];
                    return acc;
                  },
                  {}
                ),
              };
            }),
          };
          return geojson;
        } else {
          return [
            ...transform({
              data: result.data,
              schema: instantaneousSchema,
            }),
          ];
        }
      });
      return data;
    } catch (err) {
      console.error(err);
    }
  }
}

export default Instantaneous;
