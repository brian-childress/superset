/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  QueryFormData,
  styled,
  SuperChart,
  DataMask,
  t,
  Behavior,
  ChartDataResponseResult,
  JsonObject,
  getChartMetadataRegistry,
} from '@superset-ui/core';
import { useDispatch } from 'react-redux';
import { areObjectsEqual } from 'src/reduxUtils';
import { getChartDataRequest } from 'src/chart/chartAction';
import Loading from 'src/components/Loading';
import BasicErrorAlert from 'src/components/ErrorMessage/BasicErrorAlert';
import { FeatureFlag, isFeatureEnabled } from 'src/featureFlags';
import { waitForAsyncData } from 'src/middleware/asyncEvent';
import {
  setFocusedNativeFilter,
  unsetFocusedNativeFilter,
} from 'src/dashboard/actions/nativeFilters';
import { ClientErrorObject } from 'src/utils/getClientErrorObject';
import { FilterProps } from './types';
import { getFormData } from '../../utils';
import { useCascadingFilters } from './state';

const FilterItem = styled.div`
  min-height: ${({ theme }) => theme.gridUnit * 11}px;
  padding-bottom: ${({ theme }) => theme.gridUnit * 3}px;
  & > div > div {
    height: auto;
  }
`;

const FilterValue: React.FC<FilterProps> = ({
  dataMaskSelected,
  filter,
  directPathToChild,
  onFilterSelectionChange,
}) => {
  const { id, targets, filterType, adhoc_filters, time_range } = filter;
  const metadata = getChartMetadataRegistry().get(filterType);
  const cascadingFilters = useCascadingFilters(id, dataMaskSelected);
  const [state, setState] = useState<ChartDataResponseResult[]>([]);
  const [error, setError] = useState<string>('');
  const [formData, setFormData] = useState<Partial<QueryFormData>>({});
  const [ownState, setOwnState] = useState<JsonObject>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const [target] = targets;
  const {
    datasetId,
    column = {},
  }: Partial<{ datasetId: number; column: { name?: string } }> = target;
  const { name: groupby } = column;
  const hasDataSource = !!datasetId;
  const [isLoading, setIsLoading] = useState<boolean>(hasDataSource);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const dispatch = useDispatch();
  useEffect(() => {
    const newFormData = getFormData({
      ...filter,
      datasetId,
      cascadingFilters,
      groupby,
      inputRef,
      adhoc_filters,
      time_range,
    });
    const filterOwnState = filter.dataMask?.ownState || {};
    if (
      !areObjectsEqual(formData, newFormData) ||
      !areObjectsEqual(ownState, filterOwnState)
    ) {
      setFormData(newFormData);
      setOwnState(filterOwnState);
      if (!hasDataSource) {
        return;
      }
      setIsRefreshing(true);
      getChartDataRequest({
        formData: newFormData,
        force: false,
        requestParams: { dashboardId: 0 },
        ownState: filterOwnState,
      })
        .then(response => {
          if (isFeatureEnabled(FeatureFlag.GLOBAL_ASYNC_QUERIES)) {
            // deal with getChartDataRequest transforming the response data
            const result = 'result' in response ? response.result[0] : response;
            waitForAsyncData(result)
              .then((asyncResult: ChartDataResponseResult[]) => {
                setIsRefreshing(false);
                setIsLoading(false);
                setState(asyncResult);
              })
              .catch((error: ClientErrorObject) => {
                setError(
                  error.message || error.error || t('Check configuration'),
                );
                setIsRefreshing(false);
                setIsLoading(false);
              });
          } else {
            setState(response.result);
            setError('');
            setIsRefreshing(false);
            setIsLoading(false);
          }
        })
        .catch((error: Response) => {
          setError(error.statusText);
          setIsRefreshing(false);
          setIsLoading(false);
        });
    }
  }, [
    cascadingFilters,
    datasetId,
    groupby,
    JSON.stringify(filter),
    hasDataSource,
  ]);

  useEffect(() => {
    if (directPathToChild?.[0] === filter.id) {
      // wait for Cascade Popover to open
      const timeout = setTimeout(() => {
        inputRef?.current?.focus();
      }, 200);
      return () => clearTimeout(timeout);
    }
    return undefined;
  }, [inputRef, directPathToChild, filter.id]);

  const setDataMask = (dataMask: DataMask) =>
    onFilterSelectionChange(filter, dataMask);

  const setFocusedFilter = () => dispatch(setFocusedNativeFilter(id));
  const unsetFocusedFilter = () => dispatch(unsetFocusedNativeFilter());

  if (error) {
    return (
      <BasicErrorAlert
        title={t('Cannot load filter')}
        body={error}
        level="error"
      />
    );
  }

  return (
    <FilterItem data-test="form-item-value">
      {isLoading ? (
        <Loading position="inline-centered" />
      ) : (
        <SuperChart
          height={20}
          width={220}
          formData={formData}
          // For charts that don't have datasource we need workaround for empty placeholder
          queriesData={hasDataSource ? state : [{ data: [{}] }]}
          chartType={filterType}
          behaviors={[Behavior.NATIVE_FILTER]}
          filterState={filter.dataMask?.filterState}
          ownState={filter.dataMask?.ownState}
          enableNoResults={metadata?.enableNoResults}
          isRefreshing={isRefreshing}
          hooks={{ setDataMask, setFocusedFilter, unsetFocusedFilter }}
        />
      )}
    </FilterItem>
  );
};

export default FilterValue;
