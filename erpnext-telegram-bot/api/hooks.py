# -*- coding: utf-8 -*-
from __future__ import unicode_literals
from .erpnext_hooks import on_task_save

doc_events = {
    "Task": {
        "on_update": on_task_save,
        "on_submit": on_task_save,
        "on_update_after_submit": on_task_save
    }
}
