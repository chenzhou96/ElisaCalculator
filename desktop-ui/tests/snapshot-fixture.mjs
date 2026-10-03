import {initialWorkspace} from '../src/workbench/model.ts'
export const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNqkAAAAASUVORK5CYII='
export function completeResult() {
  const row = {Group:'Reference', N:8, EC50:0.17677669529663692, LogEC50:-0.7525749891599529, Slope:1.8000000000000003, Global_A:0.08000000000000003, Global_D:2.88, R2:1, RMSE:1.6918668327754196e-16, Status:'Success', Warning:'audit warning', warning_list:['audit warning'], Relative_stock_potency_X:10}
  return {
    ok:true, results:[row], previews:[{id:'overview',group_name:null,data_url:png}], preview_warnings:[], export_warnings:[], saved_files:[],
    report:{fit_success:true,fit_error:'',global_params:{A:0.08000000000000003,D:2.88},summary_rows:[structuredClone(row)],detailed_rows:[{group_name:'Reference',x:[-0.3010299956639812],y:[2.761493605490578],raw_x:['1'],raw_y:['2.761493605490578'],y_pred:[2.7614936054905783],status:'Success',warning_list:[],skip_reason:'',params:{A:0.08000000000000003,B:1.8000000000000003,C:-0.7525749891599529,D:2.88},r2:1,rmse:1.6918668327754196e-16,processed_points:[{source_row:1,source_column:'Reference',raw_x:'1',raw_y:'2.761493605490578',log_dose:0,processed_y:2.761493605490578,included:true,exclusion_reason:''}]}],unknown_results:[],options:structuredClone(initialWorkspace.options),metadata:{engine_version:'fixture',unrounded:1.2345678912345678},comparison:{notes:'preserve backend-only metadata'}}
  }
}
export function workspaceWithResult() {
  return {...structuredClone(initialWorkspace),rawText:'X,Y\n1,2.761493605490578',source:'实验数据.csv',parsed:{ok:true,meta:{columns:['X','Y']},preview_columns:['X','Y'],preview_rows:[{X:1,Y:2.761493605490578}],row_count:1,column_count:2},result:completeResult()}
}
