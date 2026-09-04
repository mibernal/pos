import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { executeAsTenant } from '../../../shared/infra/db/rls.js';

export async function publicCatalogRoutes(app: FastifyInstance) {
  app.get(
    '/public/catalog/:branchId',
    {
      schema: {
        tags: ['Public Catalog'],
        summary: 'Obtener catálogo público de una sucursal',
        params: z.object({
          branchId: z.string().uuid()
        })
      }
    },
    async (request, reply) => {
      const { branchId } = request.params as { branchId: string };
      
      // We need to fetch branch details to know its tenantId,
      // because we don't have request.auth (it's a public route).
      const branch = await app.db
        .selectFrom('branches')
        .select(['id', 'tenant_id', 'name'])
        .where('id', '=', branchId)
        .executeTakeFirst();
      
      if (!branch) {
        return reply.status(404).send({ error: 'Sucursal no encontrada' });
      }

      // Fetch active products with their categories for this tenant/branch
      // Usamos executeAsTenant con el tenantId de la sucursal descubierta
      const { products } = await executeAsTenant(app.db, branch.tenant_id, async (trx) => {
        const prods = await trx
          .selectFrom('products')
          .select([
            'id', 
            'category as category_id', 
            'name', 
            'description', 
            'price_cents', 
            'active', 
            'image_url', 
          ])
          .where('tenant_id', '=', branch.tenant_id)
          .where('active', '=', true)
          // La carta es la de esta sucursal. Filtrar solo por comercio hacía que el QR de un
          // local enseñara los platos de todos, incluidos los de una cocina que no está aquí.
          .where((eb) => eb.or([eb('branch_id', '=', branch.id), eb('branch_id', 'is', null)]))
          .orderBy('name', 'asc')
          .execute();
          
        return { products: prods };
      });
      
      const uniqueCategories = Array.from(new Set(products.map(p => p.category_id)));
      const categories = uniqueCategories.map(name => ({
        id: name,
        name: name,
        color: 'gray' // Default color since we don't store it in products table
      }));
        
      // Fetch product images public URLs if necessary, but we can just return image_id
      // because there's already a public endpoint for images: GET /api/v1/products/images/:imageId

      // Let's group products by category
      const catalog = categories.map(cat => ({
        ...cat,
        products: products
          .filter(p => p.category_id === cat.id)
          .map(p => ({
            id: p.id,
            name: p.name,
            description: p.description,
            priceCents: p.price_cents,
            imageUrl: p.image_url,
          }))
      })).filter(cat => cat.products.length > 0); // Only return categories with active products

      return reply.send({
        branch: {
          id: branch.id,
          name: branch.name
        },
        catalog
      });
    }
  );
}
