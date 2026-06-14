import { Global, Module } from "@nestjs/common";
import { GraphService } from "./graph.service";

@Global()
@Module({
  providers: [GraphService],
  exports: [GraphService],
})
export class GraphModule {}
