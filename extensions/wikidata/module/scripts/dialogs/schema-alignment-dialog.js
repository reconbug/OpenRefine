/*

Copyright 2010, Google Inc.
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

 * Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.
 * Redistributions in binary form must reproduce the above
copyright notice, this list of conditions and the following disclaimer
in the documentation and/or other materials provided with the
distribution.
 * Neither the name of Google Inc. nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,           
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY           
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

 */

var SchemaAlignment = {};

SchemaAlignment.autoAlign = function() {
  var protograph = {};

  var columns = theProject.columnModel.columns;

  var typedCandidates = [];
  var candidates = [];

  for (var c = 0; c < columns.length; c++) {
    var column = columns[c];
    var typed = (column.reconConfig) && 
    ReconciliationManager.isFreebaseIdOrMid(column.reconConfig.identifierSpace) &&
    ReconciliationManager.isFreebaseId(column.reconConfig.schemaSpace);

    var candidate = {
      status: "unbound",
      typed: typed,
      index: c,
      column: column
    };

    candidates.push(candidate);
    if (typed) {
      typedCandidates.push(candidate);
    }
  }

  if (typedCandidates.length > 0) {

  } else {
    var queries = {};
    for (var i = 0; i < candidates.length; i++) {
      var candidate = candidates[i];
      var name = SchemaAlignment._cleanName(candidate.column.name);
      var key = "t" + i + ":search";
      queries[key] = {
        "query" : name,
        "limit" : 10,
        "type" : "/type/type,/type/property",
        "type_strict" : "any"
      };
    }

    SchemaAlignment._batchSearch(queries, function(result) {
      console.log(result);
    });
  }
};

SchemaAlignment._cleanName = function(s) {
  return s.replace(/\W/g, " ").replace(/\s+/g, " ").toLowerCase();
};

var SchemaAlignmentDialog = {};

SchemaAlignmentDialog.launch = function(onDone) {
  this._onDone = onDone;
  this._hasUnsavedChanges = false;

  this._createDialog();
  this._reset(theProject.overlayModels.wikibaseSchema, true);
}

SchemaAlignmentDialog._reset = function(schema, initial) {
  this._originalSchema = schema || { itemDocuments: [] };
  this._schema = cloneDeep(this._originalSchema); // this is what can be munched on

  $('#schema-alignment-statements-container').empty();

  if (this._schema && this._schema.itemDocuments) {
    for(var i = 0; i != this._schema.itemDocuments.length; i++) {
      this._addItem(this._schema.itemDocuments[i]);
    }
  }

  if (!this._schema.itemDocuments.length) {
    // this._addItem();
  }
  this.preview(initial);
};

SchemaAlignmentDialog._save = function(onDone) {
  var self = this;
  var schema = this.getJSON();

  Refine.postProcess(
    "wikidata",
    "save-wikibase-schema",
    {},
    { schema: JSON.stringify(schema) },
    {},
    {   
      onDone: function() {
        theProject.overlayModels.wikibaseSchema = schema;

        self._elmts.statusIndicator.hide();
        $('.invalid-schema-warning').hide();
        self._hasUnsavedChanges = false;

        if (onDone) onDone();
      }
    }
  );
};

SchemaAlignmentDialog._createDraggableColumn = function(name, reconciled) {
  var cell = $("<div></div>").addClass('wbs-draggable-column').text(name);
  if (reconciled) {
    cell.addClass('wbs-reconciled-column');
  } else {
    cell.addClass('wbs-unreconciled-column');
  }
  return cell;
}

SchemaAlignmentDialog._createDialog = function() {
  var self = this;
  var frame = $(DOM.loadHTML("wikidata", "scripts/dialogs/schema-alignment-dialog.html"));
  var elmts = this._elmts = DOM.bind(frame);

  this._level = DialogSystem.showDialog(frame);
  this._wikibasePrefix = "http://www.wikidata.org/entity/"; // hardcoded for now

  // Init the column area
  var columns = theProject.columnModel.columns;
  this._columnArea = $(".schema-alignment-dialog-columns-area");
  for (var i = 0; i < columns.length; i++) {
     var column = columns[i];
     var reconConfig = column.reconConfig;
     var cell = SchemaAlignmentDialog._createDraggableColumn(column.name, 
        reconConfig && reconConfig.identifierSpace === this._wikibasePrefix && column.reconStats);
     this._columnArea.append(cell);
  }

  $('.wbs-reconciled-column').draggable({
     helper: "clone",
     cursor: "crosshair",
     snap: ".wbs-item-input input, .wbs-target-input input",
     zIndex: 100,
  });
  $('.wbs-unreconciled-column').draggable({
     helper: "clone",
     cursor: "crosshair",
     snap: ".wbs-target-input input",
     zIndex: 100,
  });


  var dismiss = function() {
    DialogSystem.dismissUntil(self._level - 1);
  };

  elmts.saveButton.click(function() {
    self._save();
  });
  elmts.resetButton.click(function() {
    self._reset(null);
  });
  elmts.closeButton.click(function() {
    if (!self._hasUnsavedChanges || window.confirm("There are unsaved changes. Close anyway?")) {
      dismiss();
    }
  });

  elmts.addItemButton.click(function() {
    self._addItem();
  });

  $("#schema-alignment-tabs").tabs();

  this._previewPanes = $(".schema-alignment-dialog-preview");

  this._canvas = $(".schema-alignment-dialog-canvas");
  this._nodeTable = $('<table></table>').addClass("schema-alignment-table-layout").appendTo(this._canvas)[0];

  var url = ReconciliationManager.ensureDefaultServicePresent();
  SchemaAlignmentDialog._reconService = ReconciliationManager.getServiceFromUrl(url);
  this.preview();
};

/**************/
/*** ITEMS ****/
/**************/

SchemaAlignmentDialog._addItem = function(json) {
  var subject = null;
  var statementGroups = null;
  var nameDescs = null;
  if (json) {
     subject = json.subject;
     statementGroups = json.statementGroups;
     nameDescs = json.nameDescs;
  }

  var item = $('<div></div>').addClass('wbs-item');
  $('#schema-alignment-statements-container').append(item);
  var inputContainer = $('<div></div>').addClass('wbs-item-input').appendTo(item);
  SchemaAlignmentDialog._initField(inputContainer, "wikibase-item", subject);
  var right = $('<div></div>').addClass('wbs-right').appendTo(item);
  $('<div></div>').addClass('wbs-namedesc-container').appendTo(right);
  var toolbar = $('<div></div>').addClass('wbs-toolbar').appendTo(right);
  $('<a></a>').addClass('wbs-add-namedesc').text('add name/description').click(function() {
     SchemaAlignmentDialog._addNameDesc(item, null);
  }).appendTo(toolbar);
  $('<div></div>').addClass('wbs-statement-group-container').appendTo(right);
  var toolbar = $('<div></div>').addClass('wbs-toolbar').appendTo(right);
  $('<a></a>').addClass('wbs-add-statement-group').text('add statement').click(function() {
     SchemaAlignmentDialog._addStatementGroup(item, null);
  }).appendTo(toolbar);
   
  if (statementGroups) {
     for(var i = 0; i != statementGroups.length; i++) {
        SchemaAlignmentDialog._addStatementGroup(item, statementGroups[i]);
     }
  } else if (!nameDescs) {
     SchemaAlignmentDialog._addStatementGroup(item);
  }
  
  if (nameDescs) {
     for(var i = 0; i != nameDescs.length; i++) {
        SchemaAlignmentDialog._addNameDesc(item, nameDescs[i]);
     }
  }
}

SchemaAlignmentDialog._itemToJSON = function (item) {
    var statementGroupLst = new Array();
    item.find('.wbs-statement-group').each(function () {
        statementGroupLst.push(SchemaAlignmentDialog._statementGroupToJSON($(this)));
    });
    var nameDescLst = new Array();
    item.find('.wbs-namedesc').each(function () {
        nameDescLst.push(SchemaAlignmentDialog._nameDescToJSON($(this)));
    });
    var inputContainer = item.find(".wbs-item-input").first();
    return {subject: SchemaAlignmentDialog._inputContainerToJSON(inputContainer),
            statementGroups: statementGroupLst,
            nameDescs: nameDescLst}; 
};

/**************************
 * NAMES AND DESCRIPTIONS *
 **************************/

SchemaAlignmentDialog._addNameDesc = function(item, json) {
  var type = 'ALIAS';
  var value = null;
  if (json) {
     type = json.name_type;
     value = json.value;
  } 

  var container = item.find('.wbs-namedesc-container').first();
  var namedesc = $('<div></div>').addClass('wbs-namedesc').appendTo(container);
  var type_container = $('<div></div>').addClass('wbs-namedesc-type').appendTo(namedesc);
  var type_input = $('<select></select>').appendTo(type_container);
  $('<option></option>')
  .attr('value', 'LABEL')
  .text('Label')
  .appendTo(type_input);
  $('<option></option>')
  .attr('value', 'DESCRIPTION')
  .text('Description')
  .appendTo(type_input);
  $('<option></option>')
  .attr('value', 'ALIAS')
  .text('Alias')
  .appendTo(type_input);

  var toolbar = $('<div></div>').addClass('wbs-toolbar').appendTo(namedesc);
  $('<img src="images/close.png" />').attr('alt', 'remove name/description').click(function() {
     namedesc.remove();
  }).appendTo(toolbar);

  var right = $('<div></div>').addClass('wbs-right').appendTo(namedesc);
  var value_container = $('<div></div>').addClass('wbs-namedesc-value').appendTo(namedesc);
  SchemaAlignmentDialog._initField(value_container, "monolingualtext", value); 

}

SchemaAlignmentDialog._nameDescToJSON = function (namedesc) {
  var type = namedesc.find('select').first().val();
  var value = namedesc.find('.wbs-namedesc-value').first().data("jsonValue");
  return {
    type: "wbnamedescexpr",    
    name_type: type,
    value: value,
  }
}
  

/********************
 * STATEMENT GROUPS *
 ********************/

SchemaAlignmentDialog._addStatementGroup = function(item, json) {
  var property = null;
  var statements = null;
  if (json) {
     property = json.property;
     statements = json.statements;
  }

  var container = item.find('.wbs-statement-group-container').first();
  var statementGroup = $('<div></div>').addClass('wbs-statement-group');
  var inputContainer = $('<div></div>').addClass('wbs-prop-input').appendTo(statementGroup);
  var right = $('<div></div>').addClass('wbs-right').appendTo(statementGroup);
  var statementContainer = $('<div></div>').addClass('wbs-statement-container').appendTo(right);
  SchemaAlignmentDialog._initPropertyField(inputContainer, statementContainer, property);
  var toolbar = $('<div></div>').addClass('wbs-toolbar').appendTo(right);
  var addValueButton = $('<a></a>').addClass('wbs-add-statement').text('add value').click(function() {
     var datatype = inputContainer.data("jsonValue").datatype;
     SchemaAlignmentDialog._addStatement(statementContainer, datatype, null);
  }).appendTo(toolbar).hide();

  container.append(statementGroup);

  if (statements) {
     for (var i = 0; i != statements.length; i++) {
        SchemaAlignmentDialog._addStatement(statementContainer, property.datatype, statements[i]);
        addValueButton.show();
     }
  }
     
}

SchemaAlignmentDialog._statementGroupToJSON = function (statementGroup) {
    var lst = new Array();
    statementGroup.find('.wbs-statement-container').first().children('.wbs-statement').each(function () {
    lst.push(SchemaAlignmentDialog._statementToJSON($(this)));
    });
    var inputContainer = statementGroup.find(".wbs-prop-input").first();
    return {property: SchemaAlignmentDialog._inputContainerToJSON(inputContainer),
            statements: lst};
};

/**************
 * STATEMENTS *
 **************/

SchemaAlignmentDialog._addStatement = function(container, datatype, json) {
  var qualifiers = null;
  var references = null;
  var value = null;
  if (json) {
    qualifiers = json.qualifiers;
    references = json.references;
    value = json.value;
  }
 
  var statement = $('<div></div>').addClass('wbs-statement');
  var toolbar1 = $('<div></div>').addClass('wbs-toolbar').appendTo(statement);
  $('<img src="images/close.png" />').attr('alt', 'remove statement').click(function() {
     SchemaAlignmentDialog._removeStatement(statement);
  }).appendTo(toolbar1);
  var inputContainer = $('<div></div>').addClass('wbs-target-input').appendTo(statement);
  SchemaAlignmentDialog._initField(inputContainer, datatype, value);
  
  // If we are in a mainsnak...
  // (see https://www.mediawiki.org/wiki/Wikibase/DataModel#Snaks)
  if (container.parents('.wbs-statement').length == 0) {

    // add qualifiers...
    var right = $('<div></div>').addClass('wbs-right').appendTo(statement);
    var qualifierContainer = $('<div></div>').addClass('wbs-qualifier-container').appendTo(right);
    var toolbar2 = $('<div></div>').addClass('wbs-toolbar').appendTo(right);
    $('<a></a>').addClass('wbs-add-qualifier').text('add qualifier').click(function() {
        SchemaAlignmentDialog._addQualifier(qualifierContainer, null);
    }).appendTo(toolbar2);
    if (qualifiers) {
       for (var i = 0; i != qualifiers.length; i++) {
         SchemaAlignmentDialog._addQualifier(qualifierContainer, qualifiers[i]);
       }
    }

    // and references
    var referencesToggleContainer = $('<div></div>').addClass('wbs-references-toggle').appendTo(statement);
    var referencesToggle = $('<a></a>').appendTo(referencesToggleContainer);
    right = $('<div></div>').addClass('wbs-right').appendTo(statement);
    var referenceContainer = $('<div></div>').addClass('wbs-reference-container').appendTo(right);
    referencesToggle.click(function () {
        referenceContainer.toggle(100);
    });
    referenceContainer.hide();
    var right2 = $('<div></div>').addClass('wbs-right').appendTo(right);
    var toolbar3 = $('<div></div>').addClass('wbs-toolbar').appendTo(right2);
    $('<a></a>').addClass('wbs-add-reference').text('add reference').click(function() {
        referenceContainer.show();
        SchemaAlignmentDialog._addReference(referenceContainer, null);
        SchemaAlignmentDialog._updateReferencesNumber(referenceContainer);
    }).appendTo(toolbar3);
    if (references) {
        for (var i = 0; i != references.length; i++) {
          SchemaAlignmentDialog._addReference(referenceContainer, references[i]);
        }
    }
    SchemaAlignmentDialog._updateReferencesNumber(referenceContainer);
  }
  container.append(statement);
}

SchemaAlignmentDialog._statementToJSON = function (statement) {
    var inputContainer = statement.find(".wbs-target-input").first();
    var qualifiersList = new Array();
    var referencesList = new Array();
    statement.find('.wbs-qualifier-container').first().children().each(function () {
        qualifiersList.push(SchemaAlignmentDialog._qualifierToJSON($(this)));
    });
    statement.find('.wbs-reference-container').first().children().each(function () {
        referencesList.push(SchemaAlignmentDialog._referenceToJSON($(this)));
    });
    return {
        value:SchemaAlignmentDialog._inputContainerToJSON(inputContainer),
        qualifiers: qualifiersList,
        references: referencesList,
    };
};

/**************
 * QUALIFIERS *
 **************/

SchemaAlignmentDialog._addQualifier = function(container, json) {
  var property = null;
  var value = null;
  if (json) {
    property = json.prop;
    value = json.value;
  }

  var qualifier = $('<div></div>').addClass('wbs-qualifier').appendTo(container);
  var toolbar1 = $('<div></div>').addClass('wbs-toolbar').appendTo(qualifier);
  var inputContainer = $('<div></div>').addClass('wbs-prop-input').appendTo(qualifier);
  var right = $('<div></div>').addClass('wbs-right').appendTo(qualifier);
  var statementContainer = $('<div></div>').addClass('wbs-statement-container').appendTo(right);
  SchemaAlignmentDialog._initPropertyField(inputContainer, statementContainer, property);
  if (value && property) {
    SchemaAlignmentDialog._addStatement(statementContainer, property.datatype, {value:value});
  }
}

SchemaAlignmentDialog._removeQualifier = function(qualifier) {
  qualifier.remove();
}

SchemaAlignmentDialog._qualifierToJSON = function(elem) {
  var prop = elem.find(".wbs-prop-input").first();
  var target = elem.find(".wbs-target-input").first();
  return {
      prop: SchemaAlignmentDialog._inputContainerToJSON(prop),
      value: SchemaAlignmentDialog._inputContainerToJSON(target),
  };
}

/**************
 * REFERENCES *
 **************/

SchemaAlignmentDialog._addReference = function(container, json) {
  var snaks = null;
  if (json) {
     snaks = json.snaks;
  }

  var reference = $('<div></div>').addClass('wbs-reference').appendTo(container);
  var referenceHeader = $('<div></div>').addClass('wbs-reference-header').appendTo(reference);
  var toolbarRef = $('<div></div>').addClass('wbs-toolbar').appendTo(referenceHeader);
  $('<img src="images/close.png" />').attr('alt', 'remove reference').click(function() {
     reference.remove();
     SchemaAlignmentDialog._updateReferencesNumber(container);
     SchemaAlignmentDialog._hasChanged();
  }).appendTo(toolbarRef);
  var right = $('<div></div>').addClass('wbs-right').appendTo(reference);
  var qualifierContainer = $('<div></div>').addClass('wbs-qualifier-container').appendTo(right);
  var toolbar2 = $('<div></div>').addClass('wbs-toolbar').appendTo(right);
  $('<a></a>').addClass('wbs-add-qualifier').text('add').click(function() {
      SchemaAlignmentDialog._addQualifier(qualifierContainer, null);
  }).appendTo(toolbar2);

  if (snaks) {
     for (var i = 0; i != snaks.length; i++) {
        SchemaAlignmentDialog._addQualifier(qualifierContainer, snaks[i]);
     }
  } else {
     SchemaAlignmentDialog._addQualifier(qualifierContainer, null);
  }
}

SchemaAlignmentDialog._referenceToJSON = function(reference) {
  var snaks = reference.find('.wbs-qualifier-container').first().children();
  var snaksList = new Array();
  snaks.each(function () {
      snaksList.push(SchemaAlignmentDialog._qualifierToJSON($(this)));
  });
  return {snaks:snaksList};
}

SchemaAlignmentDialog._updateReferencesNumber = function(container) {
  var childrenCount = container.children().length;
  var statement = container.parents('.wbs-statement');
  var a = statement.find('.wbs-references-toggle a').first();
  a.html(childrenCount+'&nbsp;references');
}

/************************
 * FIELD INITIALIZATION *
 ************************/

SchemaAlignmentDialog._getPropertyType = function(pid, callback) {
  $.ajax({
      url:'https://www.wikidata.org/w/api.php',
      data: {
        action: "wbgetentities",
        format: "json",
        ids: pid,
        props: "datatype",
     },
     dataType: "jsonp",
     success: function(data) {
        callback(data.entities[pid].datatype);
     }});
}

SchemaAlignmentDialog._initPropertyField = function(inputContainer, targetContainer, initialValue) {
  var input = $('<input></input>').appendTo(inputContainer);
  input.attr("placeholder", "property");

  if (this._reconService !== null) {
    endpoint = this._reconService.suggest.property;
    var suggestConfig = $.extend({}, endpoint);
    suggestConfig.key = null;
    suggestConfig.query_param_name = "prefix";

    input.suggestP(suggestConfig).bind("fb-select", function(evt, data) {
        // Fetch the type of this property and add the appropriate target value type
        var statementGroup = inputContainer.parents(".wbs-statement-group, .wbs-qualifier").first();
        SchemaAlignmentDialog._getPropertyType(data.id, function(datatype) {
          inputContainer.data("jsonValue", {
            type : "wbpropconstant",
            pid : data.id,
            label: data.name,
            datatype: datatype,
          });
          SchemaAlignmentDialog._addStatement(targetContainer, datatype, null);
          var addValueButtons = targetContainer.parent().find('.wbs-add-statement');
          addValueButtons.show();
        });
        SchemaAlignmentDialog._hasChanged();
    }).bind("fb-textchange", function(evt, data) {
        inputContainer.data("jsonValue", null);
        targetContainer.find('.wbs-statement').remove();
        var addValueButtons = targetContainer.parent().find('.wbs-add-statement');
        addValueButtons.hide();
    });
  }

  // Init with the provided initial value.
  if (initialValue) {
     if (initialValue.type === "wbpropconstant") {
        input.val(initialValue.label);
     } 
     inputContainer.data("jsonValue", initialValue);
  }

}

SchemaAlignmentDialog._initField = function(inputContainer, mode, initialValue, changedCallback) {
  var input = $('<input></input>').appendTo(inputContainer);
 
  if (! changedCallback) {
    changedCallback = SchemaAlignmentDialog._hasChanged;
  }

  if (this._reconService !== null && mode === "wikibase-item") {
    input.attr("placeholder", "item or reconciled column");
    var endpoint = null;
    endpoint = this._reconService.suggest.entity;
    var suggestConfig = $.extend({}, endpoint);
    suggestConfig.key = null;
    suggestConfig.query_param_name = "prefix";

    input.suggestP(suggestConfig).bind("fb-select", function(evt, data) {
        inputContainer.data("jsonValue", {
            type : "wbitemconstant",
            qid : data.id,
            label: data.name,
        });
        changedCallback();
    });
  } else if (mode === "time") {
     input.attr("placeholder", "YYYY(-MM(-DD))...");
     var propagateValue = function(val) {
        // TODO add validation here
        inputContainer.data("jsonValue", {
           type: "wbdateconstant",
           value: val,
        });
    };
    propagateValue("");
    input.change(function() {
      propagateValue($(this).val());
      changedCallback();
    });
   } else if (mode === "globe-coordinate") {
     input.attr("placeholder", "lat/lon");
     var propagateValue = function(val) {
        // TODO add validation here
        inputContainer.data("jsonValue", {
           type: "wblocationconstant",
           value: val,
        });
    };
    propagateValue("");
    input.change(function() {
      propagateValue($(this).val());
      changedCallback();
    });
   } else if (mode === "quantity") {
     alert("not supported yet!");
   } else if (mode === "language") {
     var initial_language_width = "20%";
     var expanded_width = "90px";
     var animation_duration = 50;
     input.attr("placeholder", "lang");
     input.addClass("wbs-language-input");
     inputContainer.width(initial_language_width);
     input.langsuggest().bind("fb-select", function(evt, data) {
        inputContainer.data("jsonValue", {
            type: "wblanguageconstant",
            id: data.id,
            label: data.name,
        });
        changedCallback();
        inputContainer.animate({ width: initial_language_width, duration: animation_duration });
     }).bind("focus.suggest", function(e) {
        inputContainer.animate({ width: expanded_width, duration: animation_duration });
     });
   } else if (mode === "monolingualtext") {
     input.remove();
     var inputContainerLanguage = $('<div></div>')
     .addClass('wbs-monolingual-container')
     .appendTo(inputContainer);
     var inputContainerValue = $('<div></div>')
     .addClass('wbs-monolingual-container')
     .width('80%')
     .appendTo(inputContainer);

     var langValue = null;
     var strValue = null;
     if (initialValue) {
         langValue = initialValue.language;
         strValue = initialValue.value;
     }

     var propagateValue = function() {
        console.log('propagateValue in monolingualtext')
        inputContainer.data("jsonValue", {
           type: "wbmonolingualexpr",
           language: inputContainerLanguage.data("jsonValue"),
           value: inputContainerValue.data("jsonValue"),
        });
        changedCallback();
     }

     SchemaAlignmentDialog._initField(inputContainerLanguage, "language", langValue, propagateValue);
     SchemaAlignmentDialog._initField(inputContainerValue, "external-id", strValue, propagateValue);
   } else { /* if (mode === "external-id") { */
    var propagateValue = function(val) {
        inputContainer.data("jsonValue", {
           type: "wbstringconstant",
           value: val,
        });
    };
    propagateValue("");
    input.change(function() {
      propagateValue($(this).val());
      changedCallback();
    });
  }

  var acceptDraggableColumn = function(column) {
    input.hide();
    var columnDiv = $('<div></div>').appendTo(inputContainer);
    column.appendTo(columnDiv);
    var deleteButton = $('&nbsp;<img src="images/close.png" />').addClass('wbs-delete-column-button').appendTo(column);
    deleteButton.attr('alt', 'remove column');
    deleteButton.click(function () {
        columnDiv.remove();
        input.show();
        changedCallback();
    });
  };

  // Make it droppable
  var acceptClass = ".wbs-draggable-column";
  var wbVariableType = "wbstringvariable";
  if (mode === "wikibase-item") {
      acceptClass = ".wbs-reconciled-column";
      wbVariableType = "wbitemvariable";
  } else if (mode === "time") {
      wbVariableType = "wbdatevariable";
  } else if (mode === "globe-coordinate") {
      wbVariableType = "wblocationvariable";
  } else if (mode === "monolingualtext") {
      wbVariableType = null; // not droppable directly
  } else if (mode === "language") {
      wbVariableType = "wblanguagevariable";
  } 
      
  if (wbVariableType) {
    inputContainer.droppable({
        accept: acceptClass,
    }).on("drop", function (evt, ui) {
        var column = ui.draggable.clone();
        acceptDraggableColumn(column);
        inputContainer.data("jsonValue", {
            type : wbVariableType,
            columnName: ui.draggable.text(),
        });
        changedCallback();
        return true; 
    }).on("dropactivate", function(evt, ui) {
        input.addClass("wbs-accepting-input");
    }).on("dropdeactivate", function(evt, ui) {
        input.removeClass("wbs-accepting-input");
    });
  }

  // Init with the provided initial value.
  if (initialValue) {
     if (initialValue.type === "wbitemconstant") {
        input.val(initialValue.label);
     } else if (initialValue.type == "wbitemvariable") {
        var cell = SchemaAlignmentDialog._createDraggableColumn(initialValue.columnName, true);
        acceptDraggableColumn(cell);
     } else if (initialValue.type === "wbstringconstant" ||
                initialValue.type === "wbdateconstant" ||
                initialValue.type === "wblocationconstant") {
        input.val(initialValue.value);
     } else if (initialValue.type === "wblanguageconstant") {
        input.val(initialValue.id);
     } else if (initialValue.type === "wbstringvariable" ||
                initialValue.type === "wbdatevariable" ||
                initialValue.type === "wblocationvariable" ||
                initialValue.type === "wblanguagevariable") {
        var cell = SchemaAlignmentDialog._createDraggableColumn(initialValue.columnName, false);
        acceptDraggableColumn(cell);
     }
     inputContainer.data("jsonValue", initialValue);
  }
}

SchemaAlignmentDialog._inputContainerToJSON = function (inputContainer) {
    var data = inputContainer.data();
    if (data) {
       return data.jsonValue;
    } else {
       return null;
    }
};

SchemaAlignmentDialog._removeStatement = function(statement) {
  var statementGroup = statement.parents('.wbs-statement-group, .wbs-qualifier').first();
  statement.remove();
  var remainingStatements = statementGroup.find('.wbs-statement').length;
  if (remainingStatements === 0) {
      statementGroup.remove();
  }
  SchemaAlignmentDialog._hasChanged();
}

SchemaAlignmentDialog.getJSON = function() {
  var list = new Array();
  $('.wbs-item').each(function () {
     list.push(SchemaAlignmentDialog._itemToJSON($(this)));
  });
  return {
        'itemDocuments': list,
        'wikibasePrefix': this._wikibasePrefix,
  };
};

SchemaAlignmentDialog._hasChanged = function() {
  this._hasUnsavedChanges = true;
  SchemaAlignmentDialog.preview(false);
}

SchemaAlignmentDialog.preview = function(initial) {
  var self = this;

  $('.invalid-schema-warning').hide();
  this._previewPanes.empty();
  var schema = this.getJSON();
  $.post(
    "command/wikidata/preview-wikibase-schema?" + $.param({ project: theProject.id }),
    { schema: JSON.stringify(schema), engine: JSON.stringify(ui.browsingEngine.getJSON()) },
    function(data) {
      if ("quickstatements" in data) {
        $(self._previewPanes[0]).text(data.quickstatements);
      }
      if ("code" in data && data.code === "error") {
         $('.invalid-schema-warning').show();
      }
    },
    "json"
  );
};

/********************
 * LANGUAGE SUGGEST *
 ********************/

$.suggest("langsuggest", {
  _init: function() {
    this.api_url = "https://www.wikidata.org/w/api.php";
    this._status.SELECT = "Select a language from the list:";
  },

  request: function(val, cursor) {
    var self = this;
    var ajax_options = {
      url: self.api_url,
      data: {   action: "languagesearch",
                search: val,
                format: "json", },
      success: function(data) {
         self.response(self.convertResults(data));
      },
      dataType: "jsonp",
     };
    $.ajax(ajax_options); 
  },
  
  convertResults: function(data) {
    var array = [];
    for (var key in data.languagesearch) {
      if (data.languagesearch.hasOwnProperty(key)) {
           array.push({ id: key, name: key, search_name: data.languagesearch[key] });
      }
    }
    return array;
  },

  create_item: function(data, response_data) {
    var css = this.options.css;
    var li = $("<li>").addClass(css.item);
    var type = $("<div>").addClass("fbs-item-type").text(data.id);
    var native_name = this.get_native_name(data.id);
    var full_name = native_name ? native_name : data.search_name;
    var label = $("<label>").text(full_name);
    li.append($("<div>").addClass(css.item_name).append(type).append(label));
    return li;
  },
 
  get_native_name: function(lang_code) {
    var language = $.uls.data.languages[lang_code];
    if (language) {
        return language[2];
    }
  },
});
