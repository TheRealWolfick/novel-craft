---
title: Recipes and blueprints
group: Data store
kind: guide
order: 3
blurb: 'Blueprints for items: build trees, bills of materials, where-used, and comparing
  recipes.'
---
A recipe (blueprint) says what an item is made of: other items (components) and materials with amounts. Components can have blueprints of their own, so a blueprint is a tree.

![The Signal Lantern and its blueprint](img/item-blueprint.png)

## Making a recipe

An item without a recipe has **Create recipe**. Fill in the description, category, tier and power system (taken from the item), the disciplines, the materials with amounts and units, the components, and an assembly text. **Browse** looks components and materials up in the drawer. Comparable recipes (same categories, power system, nearby tier) are listed beside the form with their totals.

The recipe is saved as `Recipes/<Item> (Blueprint).md`, and the item links to it.

## Build tree and bill of materials

An item or blueprint page shows the **build tree** (every component down to raw materials) and the **bill of materials** for any number of units. **Copy callout** copies a blueprint callout for that count.

Materials and items show **Used in**: every blueprint that needs them.
